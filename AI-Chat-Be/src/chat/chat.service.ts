import { Observable, Subject, from, switchMap } from 'rxjs';
import { Between, Like, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  FileContent,
  Message,
  MessageAgentStep,
  MessageContextUsage,
  MessageRole,
  MessageSource,
  MessageStatus,
  MessageToolCall,
} from './entities/message.entity';
import { Chat } from './entities/chat.entity';

import { AiService } from 'src/ai/ai.service';
import { FileService } from 'src/file/file.service';
import { AgentRunner } from 'src/agent-runtime/runner/agent-runner.service';
import {
  AgentHistoryMessage,
  AgentMemorySummary,
  AgentRunError,
  AgentRuntimeEvent,
  AgentToolExecutionResult,
} from 'src/agent-runtime/contracts';

import { UpdateTitleDto } from './dto/update-title.dto';
import { SearchChatDto } from './dto/search-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMemoryService } from './services/chat-memory.service';

type StreamEventPayload =
  | {
      type: 'chunk';
      generationId: string;
      seq: number;
      timestamp: number;
      content: string;
      isComplete: false;
    }
  | {
      type: 'complete';
      generationId: string;
      seq: number;
      timestamp: number;
      content: string;
      isComplete: true;
      knowledgeBaseId?: string;
      sources?: MessageSource[];
      toolCalls?: MessageToolCall[];
      agentSteps?: MessageAgentStep[];
      contextUsage?: MessageContextUsage;
    }
  | {
      type: 'error';
      generationId?: string;
      seq?: number;
      timestamp: number;
      content: string;
      code?: string;
      isComplete: true;
    }
  | {
      type: 'cancelled';
      generationId: string;
      seq: number;
      timestamp: number;
      content: string;
      isComplete: true;
      agentSteps?: MessageAgentStep[];
    }
  | (AgentRuntimeEvent & {
      seq: number;
    });

type StreamGenerationCache = {
  chatId: string;
  userId: number;
  generationId: string;
  events: StreamEventPayload[];
  status: 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
  controller?: AbortController;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

class GenerationCancelledError extends Error {
  constructor() {
    super('用户取消了本次生成');
    this.name = 'GenerationCancelledError';
  }
}

export type SendMessageResult =
  | {
      status: 'created';
      generationId: string;
    }
  | {
      status: 'duplicate';
      messageId: string;
    }
  | {
      status: 'cancelled';
      generationId: string;
    };

export type CancelGenerationResult = {
  generationId: string;
  status: StreamGenerationCache['status'];
  alreadyTerminal: boolean;
};

type MessageMetadata = {
  knowledgeBaseId?: string;
  sources?: MessageSource[];
  toolCalls?: MessageToolCall[];
  agentSteps?: MessageAgentStep[];
  contextUsage?: MessageContextUsage;
  status?: MessageStatus;
};

@Injectable()
export class ChatService {
  private chatSubjects = new Map<string, Subject<MessageEvent>>();

  private streamGenerations = new Map<string, StreamGenerationCache>();

  private logger = new Logger();

  @Inject(FileService)
  private fileService: FileService;

  @Inject(AiService)
  private aiService: AiService;

  @Inject(AgentRunner)
  private agentRunner: AgentRunner;

  @Inject(ChatMemoryService)
  private chatMemoryService: ChatMemoryService;

  @InjectRepository(Chat)
  private chatRepository: Repository<Chat>;

  @InjectRepository(Message)
  private messageRepository: Repository<Message>;

  constructor() {}

  getStreamEvents(
    chatId: string,
    generationId?: string,
    afterSeq = 0,
  ): Observable<MessageEvent> {
    if (!this.chatSubjects.has(chatId)) {
      this.chatSubjects.set(chatId, new Subject<MessageEvent>());
    }

    const subject = this.chatSubjects.get(chatId);
    if (!subject) {
      throw new HttpException('Chat stream not found', HttpStatus.NOT_FOUND);
    }

    return new Observable<MessageEvent>((subscriber) => {
      if (generationId) {
        const generation = this.streamGenerations.get(generationId);
        if (generation?.chatId === chatId) {
          generation.events
            .filter((event) => (event.seq || 0) > afterSeq)
            .forEach((event) => subscriber.next(this.createMessageEvent(event)));
        }
      }

      const subscription = subject.subscribe({
        next: (event) => {
          if (
            !generationId ||
            this.getEventGenerationId(event) === generationId
          ) {
            subscriber.next(event);
          }
        },
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      return () => subscription.unsubscribe();
    });
  }

  sendMessageToChat(chatId: string, message: unknown) {
    if (this.chatSubjects.has(chatId)) {
      const subject = this.chatSubjects.get(chatId);
      subject?.next(this.createMessageEvent(message));
    }
  }

  async useGeminiToChat({
    id,
    message,
    imgUrl,
    fileId,
    clientMessageId,
    generationId: requestedGenerationId,
    knowledgeBaseId,
    regenerate,
  }: SendMessageDto, userId: number): Promise<SendMessageResult> {
    await this.assertChatOwner(id, userId);

    const generationId = requestedGenerationId || randomUUID();
    if (this.streamGenerations.has(generationId)) {
      throw new HttpException(
        'Generation already exists',
        HttpStatus.CONFLICT,
      );
    }
    const controller = new AbortController();
    const generation: StreamGenerationCache = {
      chatId: id,
      userId,
      generationId,
      events: [],
      status: 'running',
      controller,
    };
    this.streamGenerations.set(generationId, generation);

    let fullContent = '';
    let seq = 0;
    let sources: MessageSource[] | undefined;
    let toolCalls: MessageToolCall[] | undefined;
    let agentSteps: MessageAgentStep[] | undefined;
    let contextUsage: MessageContextUsage | undefined;

    try {
      let filePath = '';
      const fileContent: FileContent[] = [];

      if (fileId) {
        try {
          const { data: file } = await this.fileService.getFile(fileId);

          filePath = file.filePath;
          fileContent.push({
            fileId,
            fileName: file.filePath,
          });
        } catch (error) {
          this.logger.error(`Failed to load file ${fileId}: ${error}`);
        }
      }

      this.throwIfGenerationCancelled(generation);

      const existingUserMessage = clientMessageId
        ? await this.messageRepository.findOne({
            where: {
              chatId: id,
              role: MessageRole.USER,
              clientMessageId,
            },
          })
        : null;

      if (existingUserMessage && !regenerate) {
        this.streamGenerations.delete(generationId);
        return {
          status: 'duplicate',
          messageId: existingUserMessage.id,
        };
      }

      const useAgent = !filePath || Boolean(knowledgeBaseId);
      let agentHistory: AgentHistoryMessage[] | undefined;
      let memorySummary: AgentMemorySummary | undefined;
      if (useAgent) {
        [agentHistory, memorySummary] = await Promise.all([
          this.loadAgentHistory(id),
          this.chatMemoryService
            .getSummary(id, knowledgeBaseId)
            .catch((error) => {
              this.logger.warn(
                `Failed to load chat memory ${id}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return undefined;
            }),
        ]);
      }

      this.throwIfGenerationCancelled(generation);

      let userMessageId = existingUserMessage?.id;
      if (!existingUserMessage) {
        const savedUserMessage = await this.saveMessage(
          id,
          message,
          MessageRole.USER,
          imgUrl,
          fileContent,
          clientMessageId,
          { knowledgeBaseId },
        );
        userMessageId = savedUserMessage.id;
      }

      if (useAgent) {
        const agentResult = await this.agentRunner.run({
          message,
          history: agentHistory,
          summary: memorySummary,
          context: {
            userId,
            chatId: id,
            generationId,
            messageId: userMessageId,
            clientMessageId,
            knowledgeBaseId,
            signal: controller.signal,
          },
          onEvent: (event) => {
            if (generation.status !== 'running') {
              return;
            }
            if (event.type === 'answer_chunk') {
              fullContent += event.content;
            }
            seq += 1;
            this.sendGenerationEvent(id, generation, {
              ...event,
              seq,
            });
          },
        });
        fullContent = agentResult.answer || fullContent;
        toolCalls = this.mapAgentToolCalls(agentResult.toolResults);
        sources = this.extractAgentSources(agentResult.toolResults);
        agentSteps = agentResult.steps;
        contextUsage = agentResult.contextUsage;
      } else {
        const completion = await this.aiService.getMain(
          message,
          filePath,
          imgUrl,
          controller.signal,
        );

        for await (const chunk of completion) {
          this.throwIfGenerationCancelled(generation);
          if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
            const content = chunk.choices[0].delta.content || '';
            if (!content) {
              continue;
            }

            fullContent += content;
            seq += 1;
            this.sendGenerationEvent(id, generation, {
              type: 'chunk',
              generationId,
              seq,
              timestamp: Date.now(),
              content,
              isComplete: false,
            });
          }
        }
      }

      this.throwIfGenerationCancelled(generation);
      if (!this.transitionGeneration(generation, 'completed')) {
        throw new GenerationCancelledError();
      }

      seq += 1;
      const completeEvent: Extract<StreamEventPayload, { type: 'complete' }> = {
        type: 'complete',
        generationId,
        seq,
        timestamp: Date.now(),
        content: fullContent,
        isComplete: true,
      };
      if (knowledgeBaseId || toolCalls?.length) {
        completeEvent.knowledgeBaseId = knowledgeBaseId;
        completeEvent.sources = sources;
        completeEvent.toolCalls = toolCalls;
      }
      completeEvent.agentSteps = agentSteps;
      completeEvent.contextUsage = contextUsage;
      this.sendGenerationEvent(id, generation, completeEvent);

      await this.saveMessage(
        id,
        fullContent,
        MessageRole.SYSTEM,
        undefined,
        undefined,
        undefined,
        {
          knowledgeBaseId,
          sources,
          toolCalls,
          agentSteps,
          contextUsage,
          status: MessageStatus.COMPLETED,
        },
      );

      if (useAgent) {
        await this.chatMemoryService
          .refreshSummary(id, knowledgeBaseId)
          .catch((error) => {
            this.logger.warn(
              `Failed to schedule chat memory ${id}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      }

      this.logger.log(`Chat ${id} response completed`);

      return {
        status: 'created',
        generationId,
      };
    } catch (error) {
      const cancelled =
        generation.status === 'cancelled' ||
        error instanceof GenerationCancelledError ||
        (error instanceof AgentRunError && error.code === 'AGENT_CANCELLED');
      const timedOut =
        error instanceof AgentRunError && error.code === 'AGENT_TIMEOUT';

      generation.status = cancelled
        ? 'cancelled'
        : timedOut
          ? 'timed_out'
          : 'failed';
      this.logger.error(
        `Chat ${id} ${cancelled ? 'cancelled' : timedOut ? 'timed out' : 'failed'}: ${error}`,
      );

      if (error instanceof AgentRunError && error.partialResult) {
        toolCalls = this.mapAgentToolCalls(error.partialResult.toolResults);
        sources = this.extractAgentSources(error.partialResult.toolResults);
        agentSteps = error.partialResult.steps;
        contextUsage = error.partialResult.contextUsage;
      }

      const errorContent = cancelled
        ? fullContent || '生成已停止。'
        : fullContent || '回复失败，请稍后重试。';
      await this.saveMessage(
        id,
        errorContent,
        MessageRole.SYSTEM,
        undefined,
        undefined,
        undefined,
        {
          knowledgeBaseId,
          sources,
          toolCalls,
          agentSteps,
          contextUsage,
          status: cancelled
            ? MessageStatus.CANCELLED
            : timedOut
              ? MessageStatus.TIMED_OUT
              : MessageStatus.FAILED,
        },
      );

      if (cancelled) {
        this.sendGenerationEvent(id, generation, {
          type: 'cancelled',
          generationId,
          seq: seq + 1,
          timestamp: Date.now(),
          content: fullContent,
          isComplete: true,
          agentSteps,
        });
        return { status: 'cancelled', generationId };
      }

      const errorEvent: StreamEventPayload = {
        type: 'error',
        generationId,
        seq: seq + 1,
        timestamp: Date.now(),
        content: `Error: ${error || 'Unknown error'}`,
        code: timedOut ? 'AGENT_TIMEOUT' : 'GENERATION_FAILED',
        isComplete: true,
      };
      this.sendGenerationEvent(id, generation, errorEvent);

      this.logger.log(
        'Reference: https://help.aliyun.com/zh/model-studio/developer-reference/error-code',
      );

      throw new HttpException(
        `Chat failed: ${error || 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      generation.controller = undefined;
      this.scheduleGenerationCleanup(generation);
    }
  }

  getOwnedStreamEvents(
    chatId: string,
    userId: number,
    generationId?: string,
    afterSeq = 0,
  ): Observable<MessageEvent> {
    return from(this.assertChatOwner(chatId, userId)).pipe(
      switchMap(() => this.getStreamEvents(chatId, generationId, afterSeq)),
    );
  }

  async cancelGeneration(
    chatId: string,
    generationId: string,
    userId: number,
  ): Promise<CancelGenerationResult> {
    await this.assertChatOwner(chatId, userId);
    const generation = this.streamGenerations.get(generationId);

    if (
      !generation ||
      generation.chatId !== chatId ||
      generation.userId !== userId
    ) {
      throw new HttpException('Generation not found', HttpStatus.NOT_FOUND);
    }

    if (generation.status !== 'running') {
      return {
        generationId,
        status: generation.status,
        alreadyTerminal: true,
      };
    }

    generation.status = 'cancelled';
    generation.controller?.abort(new GenerationCancelledError());

    return {
      generationId,
      status: 'cancelled',
      alreadyTerminal: false,
    };
  }

  async saveMessage(
    chatId: string,
    content: string,
    role: MessageRole,
    imgUrl?: string[],
    fileContent?: FileContent[],
    clientMessageId?: string,
    metadata: MessageMetadata = {},
  ) {
    const message = this.messageRepository.create({
      chatId,
      content,
      role,
      imgUrl,
      fileContent,
      clientMessageId,
      knowledgeBaseId: metadata.knowledgeBaseId,
      sources: metadata.sources,
      toolCalls: metadata.toolCalls,
      agentSteps: metadata.agentSteps,
      contextUsage: metadata.contextUsage,
      status: metadata.status ?? MessageStatus.COMPLETED,
    });

    return await this.messageRepository.save(message);
  }

  async getChatMessages(chatId: string) {
    return await this.messageRepository.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
    });
  }

  private async assertChatOwner(chatId: string, userId: number) {
    const chat = await this.chatRepository.findOne({
      where: { id: chatId, userId, isActive: true },
    });

    if (!chat) {
      throw new HttpException('Chat not found or access denied', HttpStatus.NOT_FOUND);
    }
  }

  private mapAgentToolCalls(
    results: AgentToolExecutionResult[],
  ): MessageToolCall[] | undefined {
    if (results.length === 0) {
      return undefined;
    }

    return results.map((result) => {
      const query = this.getStringProperty(result.input, 'query');
      const sources =
        result.status === 'completed'
          ? this.getKnowledgeSources(result.output)
          : undefined;

      return {
        toolCallId: result.toolCallId,
        name: result.toolName,
        status: result.status,
        input: result.input,
        output: result.status === 'completed' ? result.output : undefined,
        error: result.status === 'failed' ? result.error : undefined,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        durationMs: result.durationMs,
        query,
        resultCount: sources?.length,
      };
    });
  }

  private extractAgentSources(
    results: AgentToolExecutionResult[],
  ): MessageSource[] | undefined {
    const sourceMap = new Map<string, MessageSource>();

    for (const result of results) {
      if (
        result.status !== 'completed' ||
        result.toolName !== 'knowledge_search'
      ) {
        continue;
      }

      for (const source of this.getKnowledgeSources(result.output) || []) {
        sourceMap.set(`${source.documentId}:${source.chunkIndex}`, source);
      }
    }

    return sourceMap.size > 0 ? [...sourceMap.values()] : undefined;
  }

  private getKnowledgeSources(output: unknown): MessageSource[] | undefined {
    if (!output || typeof output !== 'object' || !('sources' in output)) {
      return undefined;
    }

    const sources = (output as { sources?: unknown }).sources;
    return Array.isArray(sources) ? (sources as MessageSource[]) : undefined;
  }

  private getStringProperty(value: unknown, property: string) {
    if (!value || typeof value !== 'object' || !(property in value)) {
      return undefined;
    }

    const propertyValue = (value as Record<string, unknown>)[property];
    return typeof propertyValue === 'string' ? propertyValue : undefined;
  }

  private async loadAgentHistory(chatId: string): Promise<AgentHistoryMessage[]> {
    const messages = await this.messageRepository.find({
      where: {
        chatId,
        status: MessageStatus.COMPLETED,
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    return messages.map((item) => ({
      id: item.id,
      clientMessageId: item.clientMessageId,
      role:
        item.role === MessageRole.USER
          ? ('user' as const)
          : ('assistant' as const),
      content: item.content,
      createdAt: item.createdAt.getTime(),
      status:
        item.status === MessageStatus.COMPLETED ? 'completed' : 'failed',
      knowledgeBaseId: item.knowledgeBaseId,
      toolCalls: item.toolCalls?.map((toolCall) => ({
        name: toolCall.name,
        status: toolCall.status,
        resultCount: toolCall.resultCount,
      })),
    }));
  }

  async createChat({
    chatTitle,
    userId,
  }: {
    chatTitle: string;
    userId: number;
  }) {
    const chat = this.chatRepository.create({
      userId,
      title: chatTitle.slice(0, 8) || 'New chat',
    });

    return await this.chatRepository.save(chat);
  }

  async updateChatTitle({ title, chatId }: UpdateTitleDto) {
    const chat = await this.getChatById(chatId);
    if (!chat) {
      throw new HttpException('Chat not found', HttpStatus.NOT_FOUND);
    }

    chat.title = title;
    return await this.chatRepository.save(chat);
  }

  async getUserChats(userId: number) {
    return await this.chatRepository.find({
      where: { userId, isActive: true },
      order: { updateTime: 'DESC' },
    });
  }

  async getChatById(id: string) {
    const chat = await this.chatRepository.findOne({
      where: { id, isActive: true },
    });

    if (!chat) {
      throw new HttpException('Chat not found', HttpStatus.NOT_FOUND);
    }

    return chat;
  }

  async deleteChat(id: string) {
    const chat = await this.getChatById(id);

    if (!chat) {
      throw new HttpException('Chat not found', HttpStatus.NOT_FOUND);
    }

    chat.isActive = false;
    await this.chatRepository.save(chat);
  }

  async searchChat({ keyWord }: SearchChatDto, userId: number) {
    return await this.chatRepository.find({
      where: { title: Like(`%${keyWord}%`), isActive: true, userId },
      order: { updateTime: 'DESC' },
    });
  }

  async getOneDayHistory(userId: number) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date();
    end.setUTCHours(23, 59, 59, 999);

    return await this.chatRepository.find({
      where: {
        userId,
        isActive: true,
        createTime: Between(start, end),
      },
    });
  }

  private sendGenerationEvent(
    chatId: string,
    generation: StreamGenerationCache,
    event: StreamEventPayload,
  ) {
    generation.events.push(event);
    this.sendMessageToChat(chatId, event);
  }

  private transitionGeneration(
    generation: StreamGenerationCache,
    status: Exclude<StreamGenerationCache['status'], 'running'>,
  ) {
    if (generation.status !== 'running') {
      return false;
    }

    generation.status = status;
    generation.controller = undefined;
    return true;
  }

  private throwIfGenerationCancelled(generation: StreamGenerationCache) {
    if (
      generation.status === 'cancelled' ||
      generation.controller?.signal.aborted
    ) {
      throw new GenerationCancelledError();
    }
  }

  private scheduleGenerationCleanup(generation: StreamGenerationCache) {
    if (generation.cleanupTimer) {
      clearTimeout(generation.cleanupTimer);
    }

    generation.cleanupTimer = setTimeout(() => {
      if (this.streamGenerations.get(generation.generationId) === generation) {
        this.streamGenerations.delete(generation.generationId);
      }
    }, 5 * 60 * 1_000);
    generation.cleanupTimer.unref?.();
  }

  private getEventGenerationId(event: MessageEvent) {
    const data = event.data;
    if (!data || typeof data !== 'object' || !('generationId' in data)) {
      return undefined;
    }

    const generationId = (data as { generationId?: unknown }).generationId;
    return typeof generationId === 'string' ? generationId : undefined;
  }

  private createMessageEvent(message: unknown) {
    const seq =
      typeof message === 'object' && message !== null && 'seq' in message
        ? String((message as { seq?: number }).seq || Date.now())
        : String(Date.now());

    return new MessageEvent('message', {
      data: message,
      lastEventId: seq,
    });
  }
}
