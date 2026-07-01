import { ChatService } from './chat.service';
import { MessageRole } from './entities/message.entity';

const createService = () => {
  const service = new ChatService();
  const messageRepository = {
    findOne: jest.fn(),
    create: jest.fn((message) => message),
    save: jest.fn(async (message) => ({ id: 'saved-message', ...message })),
    find: jest.fn(),
  };
  const aiService = {
    getMain: jest.fn(),
  };

  (service as unknown as { messageRepository: typeof messageRepository }).messageRepository =
    messageRepository;
  (service as unknown as { aiService: typeof aiService }).aiService = aiService;
  (service as unknown as { fileService: unknown }).fileService = {
    getFile: jest.fn(),
  };

  return { service, messageRepository, aiService };
};

describe('ChatService', () => {
  it('skips ai generation when the same clientMessageId was already saved', async () => {
    const { service, messageRepository, aiService } = createService();
    const existingUserMessage = {
      id: 'message-1',
      chatId: 'chat-1',
      clientMessageId: 'cm-1',
      role: MessageRole.USER,
      content: 'hello',
    };

    messageRepository.findOne.mockResolvedValue(existingUserMessage);
    aiService.getMain.mockImplementation(async function* () {
      yield {
        choices: [
          {
            delta: {
              content: 'duplicate response',
            },
          },
        ],
      };
    });

    const result = await service.useGeminiToChat({
      id: 'chat-1',
      message: 'hello',
      clientMessageId: 'cm-1',
    });

    expect(result).toEqual({ status: 'duplicate', messageId: 'message-1' });
    expect(aiService.getMain).not.toHaveBeenCalled();
    expect(messageRepository.save).not.toHaveBeenCalled();
  });

  it('replays cached stream events after the requested sequence', async () => {
    const { service, messageRepository, aiService } = createService();
    messageRepository.findOne.mockResolvedValue(null);
    aiService.getMain.mockImplementation(async function* () {
      yield { choices: [{ delta: { content: 'hel' } }] };
      yield { choices: [{ delta: { content: 'lo' } }] };
    });

    const result = await service.useGeminiToChat({
      id: 'chat-1',
      message: 'hello',
      clientMessageId: 'cm-2',
    });

    expect(result.status).toBe('created');
    if (result.status !== 'created') {
      throw new Error('Expected created result');
    }

    const replayed: unknown[] = [];
    const subscription = service
      .getStreamEvents('chat-1', result.generationId, 1)
      .subscribe((event) => replayed.push(event.data));

    await new Promise((resolve) => setTimeout(resolve, 0));
    subscription.unsubscribe();

    expect(replayed).toEqual([
      {
        type: 'chunk',
        generationId: result.generationId,
        seq: 2,
        content: 'lo',
        isComplete: false,
      },
      {
        type: 'complete',
        generationId: result.generationId,
        seq: 3,
        content: 'hello',
        isComplete: true,
      },
    ]);
  });
});