import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatOpenAI } from '@langchain/openai';
import { Runnable } from '@langchain/core/runnables';
import { ChainValues } from '@langchain/core/utils/types';
import { GenerateContentDto } from './dto/create-agent.dto';
import { AgentType } from './entities/agent.entity';
import { MbtiService } from './services/mbti.service';
import { KnowledgeService } from 'src/knowledge/knowledge.service';

@Injectable()
export class AgentService {
  private readonly llm: ChatOpenAI;
  private poetryAgent: Runnable<{ input: string }, string>;
  private xiaohongshuAgent: Runnable<{ input: string }, string>;

  constructor(
    private readonly mbtiService: MbtiService,
    private readonly configService: ConfigService,
    private readonly knowledgeService: KnowledgeService,
  ) {
    this.llm = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('DASHSCOPE_API_KEY'),
      configuration: {
        baseURL:
          this.configService.get<string>('DASHSCOPE_BASE_URL') ??
          'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
      modelName:
        this.configService.get<string>('DASHSCOPE_AGENT_MODEL') ?? 'qwen-long',
      temperature: 0.8,
    });

    this.initializeAgents();
  }

  async generateContent(generateContentDto: GenerateContentDto): Promise<{
    success: boolean;
    data: {
      content: string | ChainValues | Record<string, any>;
      agentType: AgentType;
      prompt: string;
    };
  }> {
    const { agentType, prompt, options } = generateContentDto;

    try {
      let result: string | ChainValues | Record<string, any>;

      switch (agentType) {
        case AgentType.POETRY:
          result = await this.generatePoetry(prompt);
          break;
        case AgentType.XIAOHONGSHU:
          result = await this.generateXiaohongshu(prompt);
          break;
        case AgentType.MBTI:
          result = await this.generateMbti(prompt, options);
          break;
        case AgentType.RAG:
          result = await this.generateKnowledgeRag(prompt, options);
          break;
        default:
          throw new HttpException('不支持的 Agent 类型', HttpStatus.BAD_REQUEST);
      }

      return {
        success: true,
        data: {
          content: result,
          agentType,
          prompt,
        },
      };
    } catch (error) {
      throw new HttpException(
        `生成内容失败: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  getAgentTemplates() {
    return [
      {
        name: '古诗词生成助手',
        type: AgentType.POETRY,
        description: '根据主题、情感、场景等要求创作古诗词。',
        examples: [
          '写一首关于春天的七言绝句',
          '创作一首思乡的五言律诗',
          '写一首描写月夜的词',
        ],
      },
      {
        name: '小红书爆款文案助手',
        type: AgentType.XIAOHONGSHU,
        description: '生成适合小红书风格的标题、正文和话题标签。',
        examples: ['护肤品推荐文案', '美食探店分享', '旅行攻略分享'],
      },
      {
        name: '知识库问答 Agent',
        type: AgentType.RAG,
        description:
          '调用 searchKnowledgeBase 工具检索 PostgreSQL + pgvector 知识库，并基于文档片段回答问题。',
        examples: [
          '总结这份文档的核心内容',
          '这份项目文档里提到了哪些技术栈？',
          '根据知识库回答这个功能是如何实现的',
        ],
      },
      {
        name: 'MBTI 咨询师助手',
        type: AgentType.MBTI,
        description: '根据用户的 MBTI 类型提供个性化的情感支持和建议。',
        examples: [
          '我是 INFP，最近工作压力很大怎么办？',
          '作为 ENTJ，如何更好地与团队沟通？',
          '我不知道我的 MBTI 类型，能帮我分析一下吗？',
        ],
      },
    ];
  }

  private initializeAgents() {
    const poetryPrompt = PromptTemplate.fromTemplate(`
你是一位精通中国古典诗词的文学助手。
请根据用户要求创作古诗词，要求格律尽量严谨、意境优美、表达自然。

用户要求：{input}
`);

    this.poetryAgent = poetryPrompt
      .pipe(this.llm)
      .pipe(new StringOutputParser());

    const xiaohongshuPrompt = PromptTemplate.fromTemplate(`
你是一位小红书内容创作助手。
请根据用户主题生成标题、正文和话题标签，要求语言自然、有吸引力、结构清晰。

用户主题：{input}
`);

    this.xiaohongshuAgent = xiaohongshuPrompt
      .pipe(this.llm)
      .pipe(new StringOutputParser());
  }

  private async generatePoetry(prompt: string): Promise<string> {
    return await this.poetryAgent.invoke({ input: prompt });
  }

  private async generateXiaohongshu(prompt: string): Promise<string> {
    return await this.xiaohongshuAgent.invoke({ input: prompt });
  }

  private async generateMbti(
    prompt: string,
    options?: Record<string, any>,
  ): Promise<string> {
    const sessionId = options?.sessionId || 'default';
    return await this.mbtiService.chat(prompt, sessionId);
  }

  private async generateKnowledgeRag(
    prompt: string,
    options?: Record<string, any>,
  ): Promise<Record<string, any>> {
    const knowledgeBaseId = options?.knowledgeBaseId;
    if (!knowledgeBaseId) {
      throw new HttpException('缺少 knowledgeBaseId', HttpStatus.BAD_REQUEST);
    }

    const userId = Number(options?.userId || 1);
    const topK = Number(options?.topK || 5);
    const ragResult = await this.knowledgeService.query(
      knowledgeBaseId,
      { query: prompt, topK },
      userId,
    );

    return {
      ...ragResult,
      toolCalls: [
        {
          name: 'searchKnowledgeBase',
          input: {
            knowledgeBaseId,
            query: prompt,
            topK,
          },
        },
      ],
    };
  }
}