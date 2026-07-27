import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentContext, AgentTool, AgentToolError } from '../contracts';
import {
  KnowledgeService,
  KnowledgeSource,
} from 'src/knowledge/knowledge.service';
import { RetrievalTrace } from 'src/knowledge/contracts/retrieval';

export const knowledgeSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(1_000),
  topK: z.number().int().min(1).max(10).default(5),
});

export interface KnowledgeSearchOutput {
  code: 'OK' | 'NO_RELIABLE_CONTEXT';
  query: string;
  effectiveQuery: string;
  knowledgeBaseId: string;
  sources: KnowledgeSource[];
  retrievalTrace: RetrievalTrace;
}

@Injectable()
export class KnowledgeSearchTool implements AgentTool<
  typeof knowledgeSearchInputSchema,
  KnowledgeSearchOutput
> {
  readonly name = 'knowledge_search';
  readonly description = '在当前用户已选择的知识库中检索与问题相关的文档片段。';
  readonly schema = knowledgeSearchInputSchema;
  readonly timeoutMs = 15_000;

  constructor(private readonly knowledgeService: KnowledgeService) {}

  isAvailable(context: AgentContext) {
    return Boolean(context.knowledgeBaseId);
  }

  async execute(
    input: z.infer<typeof knowledgeSearchInputSchema>,
    context: AgentContext,
  ): Promise<KnowledgeSearchOutput> {
    if (!context.knowledgeBaseId) {
      throw new AgentToolError(
        'KNOWLEDGE_BASE_REQUIRED',
        '调用 knowledge_search 前必须选择知识库',
      );
    }

    const result = await this.knowledgeService.searchForTool(
      context.knowledgeBaseId,
      input.query,
      input.topK,
      context.userId,
      context.signal,
      {
        history: context.retrievalHistory,
        summary: context.retrievalSummary,
      },
    );

    return {
      code: result.sources.length > 0 ? 'OK' : 'NO_RELIABLE_CONTEXT',
      query: input.query,
      effectiveQuery: result.trace.effectiveQuery,
      knowledgeBaseId: context.knowledgeBaseId,
      sources: result.sources,
      retrievalTrace: result.trace,
    };
  }
}
