import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentContext,
  AgentHistoryMessage,
  AgentMemorySummary,
  AgentModelTurnResult,
  AgentRuntimeEvent,
  AgentRuntimeEventHandler,
  AgentRunError,
  AgentRunResult,
  AgentRunSnapshot,
} from '../contracts';
import { OpenAICompatibleAgentModel } from '../adapters/openai-compatible-agent-model.service';
import { ToolExecutor } from '../executor/tool-executor.service';
import { ToolRegistry } from '../registry/tool-registry.service';
import { AgentContextBuilder } from '../context/agent-context-builder.service';

interface RunAgentInput {
  message: string;
  context: AgentContext;
  history?: AgentHistoryMessage[];
  summary?: AgentMemorySummary;
  onEvent?: AgentRuntimeEventHandler;
}

@Injectable()
export class AgentRunner {
  private readonly maxToolRounds: number;
  private readonly totalTimeoutMs: number;

  constructor(
    private readonly model: OpenAICompatibleAgentModel,
    private readonly toolRegistry: ToolRegistry,
    private readonly toolExecutor: ToolExecutor,
    private readonly contextBuilder: AgentContextBuilder,
    configService: ConfigService,
  ) {
    this.maxToolRounds = this.readBoundedInteger(
      configService.get<string>('AGENT_MAX_TOOL_ROUNDS'),
      3,
      1,
      5,
    );
    this.totalTimeoutMs = this.readBoundedInteger(
      configService.get<string>('AGENT_TOTAL_TIMEOUT_MS'),
      45_000,
      1_000,
      120_000,
    );
  }

  async run({
    message,
    context,
    history,
    summary,
    onEvent,
  }: RunAgentInput): Promise<AgentRunResult> {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(context.signal?.reason);
    if (context.signal?.aborted) {
      abortFromParent();
    } else {
      context.signal?.addEventListener('abort', abortFromParent, { once: true });
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let didTimeout = false;
    const state: AgentRunSnapshot = {
      steps: [],
      toolResults: [],
    };
    const execution = this.executeLoop(
      message,
      {
        ...context,
        signal: controller.signal,
      },
      state,
      history,
      summary,
      onEvent,
    );
    let rejectCancellation: ((reason?: unknown) => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const rejectOnAbort = () => {
      rejectCancellation?.(
        new AgentRunError('AGENT_CANCELLED', '用户取消了本次生成', state),
      );
    };
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    if (controller.signal.aborted) {
      rejectOnAbort();
    }

    try {
      return await Promise.race([
        execution,
        cancellation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            didTimeout = true;
            const timeoutError = new AgentRunError(
              'AGENT_TIMEOUT',
              `Agent 执行超过 ${this.totalTimeoutMs}ms`,
              state,
            );
            controller.abort(timeoutError);
            reject(timeoutError);
          }, this.totalTimeoutMs);
        }),
      ]);
    } catch (error) {
      if (didTimeout) {
        throw new AgentRunError(
          'AGENT_TIMEOUT',
          `Agent 执行超过 ${this.totalTimeoutMs}ms`,
          state,
        );
      }
      if (context.signal?.aborted) {
        throw new AgentRunError(
          'AGENT_CANCELLED',
          '用户取消了本次生成',
          state,
        );
      }
      if (error instanceof AgentRunError) {
        throw error;
      }
      throw new AgentRunError(
        'AGENT_EXECUTION_FAILED',
        error instanceof Error ? error.message : String(error),
        state,
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      controller.signal.removeEventListener('abort', rejectOnAbort);
      context.signal?.removeEventListener('abort', abortFromParent);
    }
  }

  private async executeLoop(
    userMessage: string,
    context: AgentContext,
    state: AgentRunSnapshot,
    history?: AgentHistoryMessage[],
    summary?: AgentMemorySummary,
    onEvent?: AgentRuntimeEventHandler,
  ): Promise<AgentRunResult> {
    const tools = this.toolRegistry.getAll(context);
    const contextBuild = this.contextBuilder.build({
      message: userMessage,
      context,
      history,
      summary,
    });
    const messages = contextBuild.messages;
    state.contextUsage = contextBuild.usage;
    const { steps, toolResults } = state;

    this.throwIfCancelled(context, state);

    this.emitEvent(onEvent, {
      type: 'generation_start',
      generationId: context.generationId,
      timestamp: Date.now(),
      availableTools: tools.map((tool) => tool.name),
      contextUsage: contextBuild.usage,
    });

    for (let toolRound = 0; toolRound <= this.maxToolRounds; toolRound += 1) {
      this.throwIfCancelled(context, state);
      const planningStartedAt = Date.now();
      const round = toolRound + 1;
      this.emitEvent(onEvent, {
        type: 'planning',
        generationId: context.generationId,
        timestamp: planningStartedAt,
        round,
        startedAt: planningStartedAt,
        status: 'running',
      });

      let turn: AgentModelTurnResult;
      try {
        turn = await this.model.complete({
          messages,
          tools,
          signal: context.signal as AbortSignal,
        });
      } catch (error) {
        const completedAt = Date.now();
        const timedOut =
          context.signal?.reason instanceof AgentRunError &&
          context.signal.reason.code === 'AGENT_TIMEOUT';
        const cancelled = Boolean(context.signal?.aborted && !timedOut);
        steps.push({
          stepId: `${context.generationId}:planning:${round}`,
          type: 'planning',
          status: cancelled ? 'cancelled' : 'failed',
          round,
          startedAt: planningStartedAt,
          completedAt,
          durationMs: completedAt - planningStartedAt,
          error: {
            code: cancelled
              ? 'AGENT_CANCELLED'
              : timedOut
                ? 'AGENT_TIMEOUT'
                : 'MODEL_CALL_FAILED',
            message: cancelled
              ? '用户取消了本次生成'
              : timedOut
                ? `Agent 执行超过 ${this.totalTimeoutMs}ms`
                : error instanceof Error
                  ? error.message
                  : String(error),
          },
          message: cancelled
            ? '模型规划已取消'
            : timedOut
              ? '模型规划已超时'
              : '模型规划失败',
        });
        this.emitEvent(onEvent, {
          type: 'planning',
          generationId: context.generationId,
          timestamp: completedAt,
          round,
          status: cancelled ? 'cancelled' : 'failed',
          startedAt: planningStartedAt,
          durationMs: completedAt - planningStartedAt,
          message: cancelled
            ? '模型规划已取消'
            : timedOut
              ? '模型规划已超时'
              : '模型规划失败',
          error: {
            code: cancelled
              ? 'AGENT_CANCELLED'
              : timedOut
                ? 'AGENT_TIMEOUT'
                : 'MODEL_CALL_FAILED',
            message: cancelled
              ? '用户取消了本次生成'
              : timedOut
                ? `Agent 执行超过 ${this.totalTimeoutMs}ms`
                : error instanceof Error
                  ? error.message
                  : String(error),
          },
        });
        if (cancelled) {
          throw new AgentRunError(
            'AGENT_CANCELLED',
            '用户取消了本次生成',
            state,
          );
        }
        throw error;
      }

      this.throwIfCancelled(context, state);

      const planningCompletedAt = Date.now();
      steps.push({
        stepId: `${context.generationId}:planning:${round}`,
        type: 'planning',
        status: 'completed',
        round,
        startedAt: planningStartedAt,
        completedAt: planningCompletedAt,
        durationMs: planningCompletedAt - planningStartedAt,
        message:
          turn.toolCalls.length > 0
            ? `模型请求调用 ${turn.toolCalls.length} 个工具`
            : '模型开始生成最终回答',
      });
      this.emitEvent(onEvent, {
        type: 'planning',
        generationId: context.generationId,
        timestamp: planningCompletedAt,
        round,
        status: 'completed',
        startedAt: planningStartedAt,
        durationMs: planningCompletedAt - planningStartedAt,
        message:
          turn.toolCalls.length > 0
            ? `模型请求调用 ${turn.toolCalls.length} 个工具`
            : '模型开始生成最终回答',
      });

      if (turn.toolCalls.length === 0) {
        if (!turn.content.trim()) {
          throw new AgentRunError(
            'EMPTY_MODEL_RESPONSE',
            '模型没有返回最终回答或工具调用',
            state,
          );
        }

        const completedAt = Date.now();
        steps.push({
          stepId: `${context.generationId}:answer`,
          type: 'answer',
          status: 'completed',
          round,
          message: '最终回答已生成',
          startedAt: planningCompletedAt,
          completedAt,
          durationMs: completedAt - planningCompletedAt,
        });

        this.emitEvent(onEvent, {
          type: 'answer_chunk',
          generationId: context.generationId,
          timestamp: completedAt,
          content: turn.content,
        });

        return {
          generationId: context.generationId,
          status: 'completed',
          answer: turn.content,
          steps,
          toolResults,
          contextUsage: contextBuild.usage,
        };
      }

      if (toolRound === this.maxToolRounds) {
        throw new AgentRunError(
          'MAX_TOOL_ROUNDS_EXCEEDED',
          `工具调用超过最大轮数 ${this.maxToolRounds}`,
          state,
        );
      }

      messages.push({
        role: 'assistant',
        content: turn.content || null,
        toolCalls: turn.toolCalls,
      });

      const roundResults = await Promise.all(
        turn.toolCalls.map(async (toolCall) => {
          const input = this.parseToolArguments(toolCall.arguments);
          this.emitEvent(onEvent, {
            type: 'tool_start',
            generationId: context.generationId,
            timestamp: Date.now(),
            round,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input,
          });
          const result = await this.toolExecutor.execute(
            {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input,
            },
            context,
          );
          this.emitEvent(onEvent, {
            type: 'tool_result',
            generationId: context.generationId,
            timestamp: result.completedAt,
            round,
            result,
          });
          return result;
        }),
      );

      for (const result of roundResults) {
        const cancelled =
          result.status === 'failed' && result.error.code === 'TOOL_ABORTED';
        steps.push({
          stepId: `${context.generationId}:tool:${result.toolCallId}`,
          type: 'tool',
          status: cancelled ? 'cancelled' : result.status,
          round,
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          input: result.input,
          output: result.status === 'completed' ? result.output : undefined,
          error: result.status === 'failed' ? result.error : undefined,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          durationMs: result.durationMs,
          message: cancelled
            ? `${result.toolName} 执行已取消`
            : result.status === 'completed'
              ? `${result.toolName} 执行完成`
              : result.error.message,
        });
        toolResults.push(result);
        messages.push({
          role: 'tool',
          toolCallId: result.toolCallId,
          content: this.contextBuilder.serializeToolResult(result),
        });
      }

      this.throwIfCancelled(context, state);
    }

    throw new AgentRunError(
      'MAX_TOOL_ROUNDS_EXCEEDED',
      `工具调用超过最大轮数 ${this.maxToolRounds}`,
      state,
    );
  }

  private parseToolArguments(rawArguments: string): unknown {
    try {
      return JSON.parse(rawArguments || '{}') as unknown;
    } catch {
      return { rawArguments };
    }
  }

  private throwIfCancelled(context: AgentContext, state: AgentRunSnapshot) {
    if (!context.signal?.aborted) {
      return;
    }

    if (context.signal.reason instanceof AgentRunError) {
      throw context.signal.reason;
    }

    throw new AgentRunError(
      'AGENT_CANCELLED',
      '用户取消了本次生成',
      state,
    );
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

  private emitEvent(
    handler: AgentRuntimeEventHandler | undefined,
    event: AgentRuntimeEvent,
  ) {
    try {
      handler?.(event);
    } catch {
      // Event observers must not break the Agent execution loop.
    }
  }
}
