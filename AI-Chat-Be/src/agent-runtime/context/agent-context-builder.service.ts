import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentContext,
  AgentContextBuildResult,
  AgentHistoryMessage,
  AgentMemorySummary,
  AgentModelMessage,
  AgentToolExecutionResult,
} from '../contracts';

interface BuildAgentContextInput {
  message: string;
  context: AgentContext;
  history?: AgentHistoryMessage[];
  summary?: AgentMemorySummary;
}

@Injectable()
export class AgentContextBuilder {
  private readonly inputBudgetTokens: number;
  private readonly responseReserveTokens: number;
  private readonly maxHistoryMessages: number;
  private readonly toolResultBudgetTokens: number;
  private readonly ragContextTokenBudget: number;
  private readonly summaryContextTokenBudget: number;

  constructor(configService: ConfigService) {
    this.inputBudgetTokens = this.readBoundedInteger(
      configService.get<string>('AGENT_CONTEXT_TOKEN_BUDGET'),
      12_000,
      2_000,
      64_000,
    );
    this.responseReserveTokens = this.readBoundedInteger(
      configService.get<string>('AGENT_RESPONSE_TOKEN_RESERVE'),
      2_000,
      500,
      16_000,
    );
    this.maxHistoryMessages = this.readBoundedInteger(
      configService.get<string>('AGENT_MAX_HISTORY_MESSAGES'),
      20,
      0,
      50,
    );
    this.toolResultBudgetTokens = this.readBoundedInteger(
      configService.get<string>('AGENT_TOOL_RESULT_TOKEN_BUDGET'),
      2_000,
      256,
      8_000,
    );
    this.ragContextTokenBudget = this.readBoundedInteger(
      configService.get<string>('RAG_CONTEXT_TOKEN_BUDGET'),
      4_000,
      256,
      16_000,
    );
    this.summaryContextTokenBudget = this.readBoundedInteger(
      configService.get<string>('AGENT_SUMMARY_CONTEXT_TOKEN_BUDGET'),
      1_200,
      128,
      4_000,
    );
  }

  build({
    message,
    context,
    history = [],
    summary,
  }: BuildAgentContextInput): AgentContextBuildResult {
    const systemMessage: AgentModelMessage = {
      role: 'system',
      content: this.buildSystemPrompt(Boolean(context.knowledgeBaseId)),
    };
    const currentMessage: AgentModelMessage = {
      role: 'user',
      content: message,
    };
    const systemTokens = this.estimateMessageTokens(systemMessage);
    const currentMessageTokens = this.estimateMessageTokens(currentMessage);
    const mandatoryTokens = systemTokens + currentMessageTokens;
    const summarySelection = this.selectSummary(
      summary,
      context,
      Math.max(this.inputBudgetTokens - mandatoryTokens, 0),
    );
    const summaryTokens = summarySelection.tokens;
    let remainingHistoryTokens = Math.max(
      this.inputBudgetTokens - mandatoryTokens - summaryTokens,
      0,
    );
    const unsummarizedHistory = summarySelection.message
      ? this.excludeSummarizedHistory(history, summary)
      : history;
    const normalizedHistory = this.normalizeHistory(
      unsummarizedHistory,
      context,
    );
    const historyCandidates =
      this.maxHistoryMessages === 0
        ? []
        : normalizedHistory.slice(-this.maxHistoryMessages);
    const droppedByFilter =
      unsummarizedHistory.length - normalizedHistory.length;
    const droppedByLimit = normalizedHistory.length - historyCandidates.length;
    const selectedHistory: AgentModelMessage[] = [];
    let historyTokens = 0;
    let droppedHistoryMessages = droppedByFilter + droppedByLimit;
    let truncatedHistoryMessages = 0;

    for (let index = historyCandidates.length - 1; index >= 0; index -= 1) {
      const candidate = historyCandidates[index];
      const content = this.formatHistoryContent(candidate);
      const modelMessage: AgentModelMessage =
        candidate.role === 'user'
          ? { role: 'user', content }
          : { role: 'assistant', content };
      const estimatedTokens = this.estimateMessageTokens(modelMessage);

      if (estimatedTokens <= remainingHistoryTokens) {
        selectedHistory.unshift(modelMessage);
        historyTokens += estimatedTokens;
        remainingHistoryTokens -= estimatedTokens;
        continue;
      }

      const messageOverhead = 4;
      const availableContentTokens = remainingHistoryTokens - messageOverhead;
      if (
        availableContentTokens >
        this.estimateTextTokens(this.truncationSuffix) + 1
      ) {
        const truncatedContent = this.truncateTextToTokens(
          content,
          availableContentTokens,
        );
        const truncatedMessage: AgentModelMessage =
          candidate.role === 'user'
            ? { role: 'user', content: truncatedContent }
            : { role: 'assistant', content: truncatedContent };
        const truncatedTokens = this.estimateMessageTokens(truncatedMessage);
        selectedHistory.unshift(truncatedMessage);
        historyTokens += truncatedTokens;
        remainingHistoryTokens = Math.max(
          remainingHistoryTokens - truncatedTokens,
          0,
        );
        truncatedHistoryMessages += 1;
      } else {
        droppedHistoryMessages += 1;
      }
    }

    const estimatedInputTokens =
      mandatoryTokens + summaryTokens + historyTokens;

    return {
      messages: [
        systemMessage,
        ...(summarySelection.message ? [summarySelection.message] : []),
        ...selectedHistory,
        currentMessage,
      ],
      usage: {
        inputBudgetTokens: this.inputBudgetTokens,
        responseReserveTokens: this.responseReserveTokens,
        estimatedInputTokens,
        systemTokens,
        currentMessageTokens,
        summaryTokens,
        historyTokens,
        includedHistoryMessages: selectedHistory.length,
        droppedHistoryMessages,
        truncatedHistoryMessages,
        toolResultBudgetTokens: this.toolResultBudgetTokens,
        ragContextTokenBudget: this.ragContextTokenBudget,
        usedSummary: Boolean(summarySelection.message),
        summarizedMessageCount: summarySelection.message
          ? summary?.summarizedMessageCount
          : undefined,
        summaryUpdatedAt: summarySelection.message
          ? summary?.updatedAt
          : undefined,
        overBudget: estimatedInputTokens > this.inputBudgetTokens,
      },
    };
  }

  estimateTextTokens(content: string) {
    let cjkCharacters = 0;
    let otherCharacters = 0;
    let whitespaceCharacters = 0;

    for (const character of content) {
      if (/\s/u.test(character)) {
        whitespaceCharacters += 1;
      } else if (
        /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
          character,
        )
      ) {
        cjkCharacters += 1;
      } else {
        otherCharacters += 1;
      }
    }

    return Math.max(
      1,
      cjkCharacters +
        Math.ceil(otherCharacters / 4) +
        Math.ceil(whitespaceCharacters / 20),
    );
  }

  truncateTextToTokens(content: string, tokenBudget: number) {
    if (this.estimateTextTokens(content) <= tokenBudget) {
      return content;
    }

    let lower = 0;
    let upper = content.length;

    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2);
      const candidate = `${content.slice(0, middle)}${this.truncationSuffix}`;
      if (this.estimateTextTokens(candidate) <= tokenBudget) {
        lower = middle;
      } else {
        upper = middle - 1;
      }
    }

    return `${content.slice(0, lower)}${this.truncationSuffix}`;
  }

  serializeToolResult(result: AgentToolExecutionResult) {
    const payload = this.buildModelToolResultPayload(result);
    const serialized = JSON.stringify(payload);
    const tokenBudget =
      result.status === 'completed' && result.toolName === 'knowledge_search'
        ? this.ragContextTokenBudget
        : this.toolResultBudgetTokens;
    const estimatedTokens = this.estimateTextTokens(serialized);

    if (estimatedTokens <= tokenBudget) {
      return serialized;
    }

    let lower = 0;
    let upper = serialized.length;
    let boundedPayload = '';

    while (lower <= upper) {
      const middle = Math.floor((lower + upper) / 2);
      const candidate = JSON.stringify({
        status: result.status,
        truncated: true,
        originalEstimatedTokens: estimatedTokens,
        preview: serialized.slice(0, middle),
      });

      if (this.estimateTextTokens(candidate) <= tokenBudget) {
        boundedPayload = candidate;
        lower = middle + 1;
      } else {
        upper = middle - 1;
      }
    }

    return (
      boundedPayload ||
      JSON.stringify({ status: result.status, truncated: true })
    );
  }

  buildRetrievalContext(
    history: AgentHistoryMessage[] = [],
    summary: AgentMemorySummary | undefined,
    context: AgentContext,
  ) {
    const normalizedHistory = this.normalizeHistory(history, context).map(
      (message) => ({
        role: message.role,
        content: message.content,
      }),
    );
    const expectedScopeKey = context.knowledgeBaseId || 'general';

    return {
      history: normalizedHistory,
      summary:
        summary?.scopeKey === expectedScopeKey ? summary.content : undefined,
    };
  }

  private buildModelToolResultPayload(result: AgentToolExecutionResult) {
    if (result.status === 'failed') {
      return { status: result.status, error: result.error };
    }

    if (result.toolName !== 'knowledge_search') {
      return { status: result.status, output: result.output };
    }

    const output =
      result.output && typeof result.output === 'object'
        ? (result.output as Record<string, unknown>)
        : {};

    return {
      status: result.status,
      output: {
        code: output.code,
        query: output.query,
        effectiveQuery: output.effectiveQuery,
        knowledgeBaseId: output.knowledgeBaseId,
        ragContext: {
          sources: Array.isArray(output.sources) ? output.sources : [],
        },
      },
    };
  }

  private normalizeHistory(
    history: AgentHistoryMessage[],
    context: AgentContext,
  ) {
    const seen = new Set<string>();
    const normalized: AgentHistoryMessage[] = [];

    for (const item of [...history].sort(
      (left, right) => right.createdAt - left.createdAt,
    )) {
      const dedupeKey = item.clientMessageId || item.id;
      const isCurrentMessage =
        item.id === context.messageId ||
        (Boolean(context.clientMessageId) &&
          item.clientMessageId === context.clientMessageId);
      const hasCompatibleKnowledgeContext =
        item.role === 'user' ||
        !item.knowledgeBaseId ||
        item.knowledgeBaseId === context.knowledgeBaseId;

      if (
        seen.has(dedupeKey) ||
        isCurrentMessage ||
        item.status !== 'completed' ||
        !item.content.trim() ||
        !hasCompatibleKnowledgeContext
      ) {
        continue;
      }

      seen.add(dedupeKey);
      normalized.push(item);
    }

    return normalized.sort((left, right) => left.createdAt - right.createdAt);
  }

  private excludeSummarizedHistory(
    history: AgentHistoryMessage[],
    summary: AgentMemorySummary | undefined,
  ) {
    if (!summary?.throughMessageId) {
      return history;
    }

    const sortedHistory = [...history].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    const boundaryIndex = sortedHistory.findIndex(
      (message) => message.id === summary.throughMessageId,
    );

    return boundaryIndex >= 0
      ? sortedHistory.slice(boundaryIndex + 1)
      : sortedHistory;
  }

  private formatHistoryContent(message: AgentHistoryMessage) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      return message.content;
    }

    const toolSummary = message.toolCalls
      .map((tool) => {
        const resultCount =
          typeof tool.resultCount === 'number'
            ? `, ${tool.resultCount} 条结果`
            : '';
        return `${tool.name}(${tool.status}${resultCount})`;
      })
      .join('、');

    return `${message.content}\n[历史工具调用：${toolSummary}]`;
  }

  private selectSummary(
    summary: AgentMemorySummary | undefined,
    context: AgentContext,
    availableTokens: number,
  ) {
    const expectedScopeKey = context.knowledgeBaseId || 'general';
    if (
      !summary?.content.trim() ||
      summary.scopeKey !== expectedScopeKey ||
      availableTokens <= 8
    ) {
      return { message: undefined, tokens: 0 };
    }

    const prefix =
      '以下是当前会话较早内容的压缩记忆。仅用于理解用户指代和持续偏好；若与最近消息冲突，以最近消息为准：\n';
    const contentBudget = Math.min(
      this.summaryContextTokenBudget,
      Math.max(availableTokens - 4, 0),
    );
    const fullContent = `${prefix}${summary.content}`;
    const content = this.truncateTextToTokens(fullContent, contentBudget);
    const message: AgentModelMessage = { role: 'system', content };
    const tokens = this.estimateMessageTokens(message);

    if (tokens > availableTokens) {
      return { message: undefined, tokens: 0 };
    }

    return { message, tokens };
  }

  private estimateMessageTokens(message: AgentModelMessage) {
    return this.estimateTextTokens(message.content || '') + 4;
  }

  private get truncationSuffix() {
    return '\n…[内容已按 Token 预算截断]';
  }

  private buildSystemPrompt(hasKnowledgeBase: boolean) {
    return `你是 Flow-Chat 的 AI 助手，可以根据用户问题自主决定是否调用工具。
规则：
1. 只有确实需要时才调用工具，普通问候和通用问题直接回答。
2. 数学计算必须使用 calculator，不要自行心算后伪造工具结果。
3. ${
      hasKnowledgeBase
        ? '用户已经选择知识库；涉及该知识库文档内容时优先调用 knowledge_search。'
        : '当前没有选择知识库，不得声称已经检索用户文档。'
    }
4. 工具失败时，根据结构化错误说明原因；不要编造不存在的工具结果。
   knowledge_search 返回 NO_RELIABLE_CONTEXT 时，明确说明知识库中没有找到可靠依据，并请用户补充信息；不得继续猜测。
5. 对依赖上文的追问，应结合提供的历史消息理解指代，但不得混用其他知识库的历史结论。
6. 最终使用中文清晰回答，并在使用知识库时忠实依据检索片段。`;
  }

  private readBoundedInteger(
    rawValue: string | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const value = Number(rawValue ?? fallback);
    if (!Number.isInteger(value)) {
      return fallback;
    }
    return Math.min(Math.max(value, minimum), maximum);
  }
}
