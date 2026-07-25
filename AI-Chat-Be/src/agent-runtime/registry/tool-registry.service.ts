import { Injectable } from '@nestjs/common';
import {
  AgentContext,
  AgentToolDefinition,
  AnyAgentTool,
} from '../contracts';

@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, AnyAgentTool>();

  register(tool: AnyAgentTool) {
    const normalizedName = this.normalizeName(tool.name);
    if (!normalizedName) {
      throw new Error('工具名称不能为空');
    }

    if (this.tools.has(normalizedName)) {
      throw new Error(`工具已注册: ${normalizedName}`);
    }

    this.tools.set(normalizedName, tool);
  }

  get(name: string) {
    return this.tools.get(this.normalizeName(name));
  }

  has(name: string) {
    return this.tools.has(this.normalizeName(name));
  }

  list(context?: AgentContext): AgentToolDefinition[] {
    return this.getAll(context).map((tool) => ({
      name: tool.name,
      description: tool.description,
      timeoutMs: tool.timeoutMs ?? 10_000,
    }));
  }

  getAll(context?: AgentContext) {
    return [...this.tools.values()].filter(
      (tool) => !context || !tool.isAvailable || tool.isAvailable(context),
    );
  }

  private normalizeName(name: string) {
    return name.trim().toLowerCase();
  }
}
