import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodFunction } from 'openai/helpers/zod';
import { randomUUID } from 'crypto';
import {
  AgentModelCompletionInput,
  AgentModelMessage,
  AgentModelTurnResult,
} from '../contracts';

@Injectable()
export class OpenAICompatibleAgentModel {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('DASHSCOPE_API_KEY'),
      baseURL:
        this.configService.get<string>('DASHSCOPE_BASE_URL') ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    this.model =
      this.configService.get<string>('DASHSCOPE_AGENT_MODEL') ??
      this.configService.get<string>('DASHSCOPE_TEXT_MODEL') ??
      'qwen-plus';
  }

  async complete({
    messages,
    tools,
    signal,
  }: AgentModelCompletionInput): Promise<AgentModelTurnResult> {
    const completion = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: messages.map((message) => this.toOpenAIMessage(message)),
        tools: tools.length
          ? tools.map((tool) => {
              const definition = zodFunction({
                name: tool.name,
                description: tool.description,
                parameters: tool.schema,
              });
              const { strict: _strict, ...compatibleFunction } =
                definition.function;

              return {
                type: 'function' as const,
                function: compatibleFunction,
              };
            })
          : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        temperature: 0.2,
      },
      { signal },
    );

    const choice = completion.choices[0];
    const responseMessage = choice?.message;

    return {
      content:
        typeof responseMessage?.content === 'string'
          ? responseMessage.content
          : '',
      toolCalls: (responseMessage?.tool_calls || [])
        .filter((toolCall) => toolCall.type === 'function')
        .map((toolCall) => ({
          id: toolCall.id || randomUUID(),
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        })),
      finishReason: choice?.finish_reason,
    };
  }

  private toOpenAIMessage(
    message: AgentModelMessage,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.toolCalls?.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        })),
      };
    }

    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    return message;
  }
}
