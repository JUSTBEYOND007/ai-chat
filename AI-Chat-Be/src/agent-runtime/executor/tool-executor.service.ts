import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AgentContext,
  AgentToolCall,
  AgentToolError,
  AgentToolErrorCode,
  AgentToolExecutionResult,
} from '../contracts';
import { ToolRegistry } from '../registry/tool-registry.service';

@Injectable()
export class ToolExecutor {
  constructor(private readonly toolRegistry: ToolRegistry) {}

  async execute(
    toolCall: AgentToolCall,
    context: AgentContext,
  ): Promise<AgentToolExecutionResult> {
    const toolCallId = toolCall.toolCallId || randomUUID();
    const startedAt = Date.now();
    const tool = this.toolRegistry.get(toolCall.toolName);

    if (!tool || (tool.isAvailable && !tool.isAvailable(context))) {
      return this.createFailure(
        toolCallId,
        toolCall.toolName,
        toolCall.input,
        startedAt,
        'TOOL_NOT_FOUND',
        `工具不存在或不可用: ${toolCall.toolName}`,
      );
    }

    const parsedInput = tool.schema.safeParse(toolCall.input);
    if (!parsedInput.success) {
      return this.createFailure(
        toolCallId,
        tool.name,
        toolCall.input,
        startedAt,
        'INVALID_TOOL_INPUT',
        parsedInput.error.issues
          .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
          .join('; '),
      );
    }

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(context.signal?.reason);
    if (context.signal?.aborted) {
      abortFromParent();
    } else {
      context.signal?.addEventListener('abort', abortFromParent, { once: true });
    }

    if (controller.signal.aborted) {
      context.signal?.removeEventListener('abort', abortFromParent);
      return this.createFailure(
        toolCallId,
        tool.name,
        parsedInput.data,
        startedAt,
        'TOOL_ABORTED',
        '工具执行已取消',
      );
    }

    const timeoutMs = tool.timeoutMs ?? 10_000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let didTimeout = false;

    try {
      const output = await Promise.race([
        tool.execute(parsedInput.data, {
          ...context,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            didTimeout = true;
            controller.abort(new Error(`工具执行超时: ${timeoutMs}ms`));
            reject(
              new AgentToolError(
                'TOOL_TIMEOUT',
                `工具执行超时: ${tool.name} (${timeoutMs}ms)`,
              ),
            );
          }, timeoutMs);
        }),
      ]);

      const completedAt = Date.now();
      return {
        toolCallId,
        toolName: tool.name,
        status: 'completed',
        input: parsedInput.data,
        output,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
      };
    } catch (error) {
      const normalizedError = this.normalizeError(
        error,
        controller.signal,
        didTimeout,
        tool.name,
        timeoutMs,
      );
      return this.createFailure(
        toolCallId,
        tool.name,
        parsedInput.data,
        startedAt,
        normalizedError.code,
        normalizedError.message,
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      context.signal?.removeEventListener('abort', abortFromParent);
    }
  }

  private normalizeError(
    error: unknown,
    signal: AbortSignal,
    didTimeout: boolean,
    toolName: string,
    timeoutMs: number,
  ): { code: AgentToolErrorCode; message: string } {
    if (didTimeout) {
      return {
        code: 'TOOL_TIMEOUT',
        message: `工具执行超时: ${toolName} (${timeoutMs}ms)`,
      };
    }

    if (error instanceof AgentToolError) {
      return { code: error.code, message: error.message };
    }

    if (signal.aborted) {
      return {
        code: 'TOOL_ABORTED',
        message: '工具执行已取消',
      };
    }

    return {
      code: 'TOOL_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  private createFailure(
    toolCallId: string,
    toolName: string,
    input: unknown,
    startedAt: number,
    code: AgentToolErrorCode,
    message: string,
  ): AgentToolExecutionResult {
    const completedAt = Date.now();
    return {
      toolCallId,
      toolName,
      status: 'failed',
      input,
      error: { code, message },
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    };
  }
}
