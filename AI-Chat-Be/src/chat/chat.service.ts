import { Observable, Subject } from 'rxjs';
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

import { FileContent, Message, MessageRole } from './entities/message.entity';
import { Chat } from './entities/chat.entity';

import { AiService } from 'src/ai/ai.service';
import { FileService } from 'src/file/file.service';

import { UpdateTitleDto } from './dto/update-title.dto';
import { SearchChatDto } from './dto/search-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';

type StreamEventPayload =
  | {
      type: 'chunk';
      generationId: string;
      seq: number;
      content: string;
      isComplete: false;
    }
  | {
      type: 'complete';
      generationId: string;
      seq: number;
      content: string;
      isComplete: true;
    }
  | {
      type: 'error';
      generationId?: string;
      seq?: number;
      content: string;
      isComplete: true;
    };

type StreamGenerationCache = {
  chatId: string;
  generationId: string;
  events: StreamEventPayload[];
};

export type SendMessageResult =
  | {
      status: 'created';
      generationId: string;
    }
  | {
      status: 'duplicate';
      messageId: string;
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

      const subscription = subject.subscribe(subscriber);
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
    regenerate,
  }: SendMessageDto): Promise<SendMessageResult> {
    const generationId = randomUUID();
    const generation: StreamGenerationCache = {
      chatId: id,
      generationId,
      events: [],
    };
    this.streamGenerations.set(generationId, generation);

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

      if (!existingUserMessage) {
        await this.saveMessage(
          id,
          message,
          MessageRole.USER,
          imgUrl,
          fileContent,
          clientMessageId,
        );
      }

      const completion = await this.aiService.getMain(message, filePath, imgUrl);

      let fullContent = '';
      let seq = 0;
      for await (const chunk of completion) {
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
            content,
            isComplete: false,
          });
        }
      }

      seq += 1;
      this.sendGenerationEvent(id, generation, {
        type: 'complete',
        generationId,
        seq,
        content: fullContent,
        isComplete: true,
      });

      await this.saveMessage(id, fullContent, MessageRole.SYSTEM);

      this.logger.log(`Chat ${id} response completed`);

      return {
        status: 'created',
        generationId,
      };
    } catch (error) {
      this.logger.error(`Chat ${id} failed: ${error}`);

      const errorEvent: StreamEventPayload = {
        type: 'error',
        generationId,
        seq: generation.events.length + 1,
        content: `Error: ${error || 'Unknown error'}`,
        isComplete: true,
      };
      generation.events.push(errorEvent);
      this.sendMessageToChat(id, errorEvent);

      this.logger.log(
        'Reference: https://help.aliyun.com/zh/model-studio/developer-reference/error-code',
      );

      throw new HttpException(
        `Chat failed: ${error || 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async saveMessage(
    chatId: string,
    content: string,
    role: MessageRole,
    imgUrl?: string[],
    fileContent?: FileContent[],
    clientMessageId?: string,
  ) {
    const message = this.messageRepository.create({
      chatId,
      content,
      role,
      imgUrl,
      fileContent,
      clientMessageId,
    });

    return await this.messageRepository.save(message);
  }

  async getChatMessages(chatId: string) {
    return await this.messageRepository.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
    });
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