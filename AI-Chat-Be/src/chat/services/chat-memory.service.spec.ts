import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { OpenAICompatibleAgentModel } from 'src/agent-runtime/adapters/openai-compatible-agent-model.service';
import { AgentContextBuilder } from 'src/agent-runtime/context/agent-context-builder.service';
import { Chat } from '../entities/chat.entity';
import {
  Message,
  MessageRole,
  MessageStatus,
} from '../entities/message.entity';
import { ChatMemoryService } from './chat-memory.service';

describe('ChatMemoryService', () => {
  const createService = () => {
    const chatRepository = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Repository<Chat>;
    const messageRepository = {
      find: jest.fn(),
    } as unknown as Repository<Message>;
    const model = {
      complete: jest.fn(),
    } as unknown as OpenAICompatibleAgentModel;
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AGENT_SUMMARY_TRIGGER_MESSAGES: '6',
          AGENT_SUMMARY_KEEP_RECENT_MESSAGES: '2',
          AGENT_SUMMARY_MIN_NEW_MESSAGES: '2',
          AGENT_SUMMARY_TOKEN_BUDGET: '256',
          AGENT_SUMMARY_SOURCE_TOKEN_BUDGET: '1000',
          AGENT_SUMMARY_TIMEOUT_MS: '5000',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const contextBuilder = new AgentContextBuilder(configService);

    return {
      service: new ChatMemoryService(
        chatRepository,
        messageRepository,
        model,
        contextBuilder,
        configService,
      ),
      chatRepository: jest.mocked(chatRepository),
      messageRepository: jest.mocked(messageRepository),
      model: jest.mocked(model),
    };
  };

  const createMessage = (
    id: string,
    role: MessageRole,
    createdAt: number,
    knowledgeBaseId?: string,
  ) =>
    ({
      id,
      chatId: 'chat-1',
      role,
      content: `${role}-${id}`,
      createdAt: new Date(createdAt),
      status: MessageStatus.COMPLETED,
      knowledgeBaseId,
    }) as Message;

  it('generates a bounded scoped summary after the threshold is reached', async () => {
    const { service, chatRepository, messageRepository, model } =
      createService();
    chatRepository.findOne.mockResolvedValue({
      id: 'chat-1',
      memoryEnabled: true,
      memorySnapshots: [],
    } as Chat);
    messageRepository.find.mockResolvedValue([
      createMessage('6', MessageRole.SYSTEM, 6, 'kb-1'),
      createMessage('5', MessageRole.USER, 5),
      createMessage('4', MessageRole.SYSTEM, 4, 'kb-1'),
      createMessage('3', MessageRole.USER, 3),
      createMessage('2', MessageRole.SYSTEM, 2, 'kb-1'),
      createMessage('1', MessageRole.USER, 1),
    ]);
    model.complete.mockResolvedValue({
      content: '- 用户正在开发 Flow-Chat。\n- 当前知识库为 kb-1。',
      toolCalls: [],
    });

    const result = await service.refreshSummary('chat-1', 'kb-1');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'updated',
        snapshot: expect.objectContaining({
          scopeKey: 'kb-1',
          throughMessageId: '4',
          summarizedMessageCount: 4,
          version: 1,
        }),
      }),
    );
    expect(model.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [],
        messages: [
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('user-1'),
          }),
        ],
      }),
    );
    expect(chatRepository.update).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        memorySnapshots: [
          expect.objectContaining({ scopeKey: 'kb-1', version: 1 }),
        ],
      }),
    );
  });

  it('keeps the previous summary when the model update fails', async () => {
    const { service, chatRepository, messageRepository, model } =
      createService();
    chatRepository.findOne.mockResolvedValue({
      id: 'chat-1',
      memoryEnabled: true,
      memorySnapshots: [],
    } as Chat);
    messageRepository.find.mockResolvedValue([
      createMessage('6', MessageRole.SYSTEM, 6),
      createMessage('5', MessageRole.USER, 5),
      createMessage('4', MessageRole.SYSTEM, 4),
      createMessage('3', MessageRole.USER, 3),
      createMessage('2', MessageRole.SYSTEM, 2),
      createMessage('1', MessageRole.USER, 1),
    ]);
    model.complete.mockRejectedValue(new Error('summary model unavailable'));

    await expect(service.refreshSummary('chat-1')).resolves.toEqual({
      status: 'failed',
      error: 'summary model unavailable',
    });
    expect(chatRepository.update).not.toHaveBeenCalled();
  });

  it('does not advance the summary boundary past messages omitted by source budget', async () => {
    const { service, chatRepository, messageRepository, model } =
      createService();
    chatRepository.findOne.mockResolvedValue({
      id: 'chat-1',
      memoryEnabled: true,
      memorySnapshots: [],
    } as Chat);
    const oldestMessage = createMessage('1', MessageRole.USER, 1);
    oldestMessage.content = '超长消息'.repeat(1000);
    messageRepository.find.mockResolvedValue([
      createMessage('6', MessageRole.SYSTEM, 6),
      createMessage('5', MessageRole.USER, 5),
      createMessage('4', MessageRole.SYSTEM, 4),
      createMessage('3', MessageRole.USER, 3),
      createMessage('2', MessageRole.SYSTEM, 2),
      oldestMessage,
    ]);
    model.complete.mockResolvedValue({
      content: '- 已压缩当前可容纳的历史。',
      toolCalls: [],
    });

    const result = await service.refreshSummary('chat-1');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'updated',
        snapshot: expect.objectContaining({
          throughMessageId: '1',
          summarizedMessageCount: 1,
        }),
      }),
    );
  });

  it('returns only the memory snapshot for the requested scope', async () => {
    const { service, chatRepository } = createService();
    chatRepository.findOne.mockResolvedValue({
      id: 'chat-1',
      memoryEnabled: true,
      memorySnapshots: [
        {
          scopeKey: 'general',
          content: '普通摘要',
          throughMessageId: '1',
          summarizedMessageCount: 6,
          updatedAt: 1,
          version: 1,
        },
        {
          scopeKey: 'kb-1',
          content: '知识库摘要',
          throughMessageId: '2',
          summarizedMessageCount: 8,
          updatedAt: 2,
          version: 2,
        },
      ],
    } as Chat);

    await expect(service.getSummary('chat-1', 'kb-1')).resolves.toEqual(
      expect.objectContaining({ scopeKey: 'kb-1', content: '知识库摘要' }),
    );
  });
});
