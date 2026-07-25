import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  QueryRewriteMode,
  QueryRewriteTrace,
  RetrievalHistoryMessage,
} from './contracts/retrieval';

export interface RewriteKnowledgeQueryInput {
  query: string;
  mode?: QueryRewriteMode;
  history?: RetrievalHistoryMessage[];
  summary?: string;
}

export interface RewriteKnowledgeQueryResult {
  originalQuery: string;
  effectiveQuery: string;
  rewrittenQuery?: string;
  trace: QueryRewriteTrace;
}

@Injectable()
export class KnowledgeQueryRewriteService {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxHistoryMessages: number;

  constructor(configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: configService.get<string>('DASHSCOPE_API_KEY'),
      baseURL:
        configService.get<string>('DASHSCOPE_BASE_URL') ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    this.model =
      configService.get<string>('DASHSCOPE_QUERY_REWRITE_MODEL') ??
      configService.get<string>('DASHSCOPE_AGENT_MODEL') ??
      configService.get<string>('DASHSCOPE_TEXT_MODEL') ??
      'qwen-plus';
    this.timeoutMs = this.readBoundedInteger(
      configService.get<string>('RAG_QUERY_REWRITE_TIMEOUT_MS'),
      5_000,
      500,
      30_000,
    );
    this.maxHistoryMessages = this.readBoundedInteger(
      configService.get<string>('RAG_QUERY_REWRITE_MAX_HISTORY_MESSAGES'),
      6,
      1,
      12,
    );
  }

  async rewrite({
    query,
    mode = 'auto',
    history = [],
    summary,
  }: RewriteKnowledgeQueryInput): Promise<RewriteKnowledgeQueryResult> {
    const originalQuery = query.trim();
    const selectedHistory = history
      .filter((message) => message.content.trim())
      .slice(-this.maxHistoryMessages)
      .map((message) => ({
        role: message.role,
        content: this.truncate(message.content.trim(), 1_500),
      }));
    const normalizedSummary = summary?.trim()
      ? this.truncate(summary.trim(), 2_000)
      : undefined;
    const traceBase = {
      mode,
      durationMs: 0,
      historyMessageCount: selectedHistory.length,
      usedSummary: Boolean(normalizedSummary),
    };

    if (mode === 'never') {
      return {
        originalQuery,
        effectiveQuery: originalQuery,
        trace: {
          ...traceBase,
          status: 'skipped',
          reason: 'disabled',
        },
      };
    }

    if (selectedHistory.length === 0 && !normalizedSummary) {
      return {
        originalQuery,
        effectiveQuery: originalQuery,
        trace: {
          ...traceBase,
          status: 'skipped',
          reason: 'missing_context',
        },
      };
    }

    if (
      mode === 'auto' &&
      !this.shouldRewrite(originalQuery, selectedHistory, normalizedSummary)
    ) {
      return {
        originalQuery,
        effectiveQuery: originalQuery,
        trace: {
          ...traceBase,
          status: 'skipped',
          reason: 'not_needed',
        },
      };
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                '你是检索查询改写器。根据摘要、最近对话和当前问题，输出一个语义完整、可独立检索的查询。不得回答问题，不得添加原对话不存在的实体、版本、数字或条件。只输出改写后的查询文本。',
            },
            {
              role: 'user',
              content: this.buildRewritePrompt(
                originalQuery,
                selectedHistory,
                normalizedSummary,
              ),
            },
          ],
        },
        { signal: controller.signal },
      );
      const rewrittenQuery = this.sanitizeRewrittenQuery(
        response.choices[0]?.message?.content,
      );
      const durationMs = Date.now() - startedAt;

      if (!rewrittenQuery) {
        return this.fallback(
          originalQuery,
          traceBase,
          'empty_result',
          durationMs,
        );
      }

      if (!this.preservesExplicitTerms(originalQuery, rewrittenQuery)) {
        return this.fallback(
          originalQuery,
          traceBase,
          'intent_guard_rejected',
          durationMs,
        );
      }

      if (
        this.normalizeForComparison(rewrittenQuery) ===
        this.normalizeForComparison(originalQuery)
      ) {
        return {
          originalQuery,
          effectiveQuery: originalQuery,
          rewrittenQuery,
          trace: {
            ...traceBase,
            status: 'skipped',
            reason: 'unchanged',
            durationMs,
          },
        };
      }

      return {
        originalQuery,
        effectiveQuery: rewrittenQuery,
        rewrittenQuery,
        trace: {
          ...traceBase,
          status: 'rewritten',
          reason: 'completed',
          durationMs,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const reason = controller.signal.aborted ? 'timeout' : 'model_error';
      return this.fallback(
        originalQuery,
        traceBase,
        reason,
        durationMs,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  shouldRewrite(
    query: string,
    history: RetrievalHistoryMessage[],
    summary?: string,
  ): boolean {
    if (history.length === 0 && !summary?.trim()) {
      return false;
    }

    const normalized = query.trim().toLowerCase();
    const chineseReference =
      /(^|[，。！？\s])(它|他|她|他们|她们|这个|那个|这些|那些|上述|前面|刚才|该|其|此)([的呢吗是有如何为什么多少哪些]|$)/;
    const englishReference =
      /\b(it|its|this|that|these|those|they|them|their|former|latter|above|previous)\b/i;
    const ellipticalPattern =
      /^(那|那么|所以)?(它|这个|那个|该功能|该方案)?(具体)?(是|有|如何|为什么|多少|哪些|怎么)/;
    const shortQuestion =
      normalized.length <= 24 || normalized.split(/\s+/).length <= 8;

    return (
      chineseReference.test(normalized) ||
      englishReference.test(normalized) ||
      (shortQuestion && ellipticalPattern.test(normalized))
    );
  }

  private buildRewritePrompt(
    query: string,
    history: RetrievalHistoryMessage[],
    summary?: string,
  ): string {
    const historyText = history.length
      ? history
          .map(
            (message) =>
              `${message.role === 'user' ? '用户' : '助手'}：${message.content}`,
          )
          .join('\n')
      : '无';

    return `会话摘要：\n${summary || '无'}\n\n最近对话：\n${historyText}\n\n当前问题：\n${query}\n\n请输出独立检索查询：`;
  }

  private sanitizeRewrittenQuery(content: unknown): string {
    if (typeof content !== 'string') {
      return '';
    }

    return content
      .replace(/^```(?:text)?\s*/i, '')
      .replace(/```$/i, '')
      .replace(/^(改写后的查询|检索查询|query)\s*[:：]\s*/i, '')
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim()
      .slice(0, 500);
  }

  private preservesExplicitTerms(
    originalQuery: string,
    rewrittenQuery: string,
  ) {
    const protectedTerms = originalQuery.match(
      /[A-Za-z][A-Za-z0-9_.:-]*\d[A-Za-z0-9_.:-]*|[A-Z][A-Z0-9_]{2,}|\d+(?:\.\d+)?(?:\s*(?:MB|GB|ms|s))?/g,
    );
    if (!protectedTerms?.length) {
      return true;
    }

    const normalizedRewrite = rewrittenQuery.toLowerCase();
    return protectedTerms.every((term) =>
      normalizedRewrite.includes(term.toLowerCase()),
    );
  }

  private normalizeForComparison(value: string) {
    return value.toLowerCase().replace(/[\s，。！？、,.!?;；:：]+/g, '');
  }

  private fallback(
    originalQuery: string,
    traceBase: Pick<
      QueryRewriteTrace,
      'mode' | 'historyMessageCount' | 'usedSummary'
    >,
    reason: Extract<
      QueryRewriteTrace['reason'],
      | 'empty_result'
      | 'intent_guard_rejected'
      | 'timeout'
      | 'model_error'
    >,
    durationMs: number,
    error?: string,
  ): RewriteKnowledgeQueryResult {
    return {
      originalQuery,
      effectiveQuery: originalQuery,
      trace: {
        ...traceBase,
        status: 'fallback',
        reason,
        durationMs,
        error,
      },
    };
  }

  private truncate(value: string, maxLength: number) {
    return value.length <= maxLength ? value : value.slice(-maxLength);
  }

  private readBoundedInteger(
    value: string | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      return fallback;
    }
    return Math.min(maximum, Math.max(minimum, parsed));
  }
}
