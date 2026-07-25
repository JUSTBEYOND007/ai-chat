import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistry } from './registry/tool-registry.service';
import { CalculatorTool } from './tools/calculator.tool';
import { KnowledgeSearchTool } from './tools/knowledge-search.tool';

@Injectable()
export class ToolRegistrationService implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly calculatorTool: CalculatorTool,
    private readonly knowledgeSearchTool: KnowledgeSearchTool,
  ) {}

  onModuleInit() {
    this.toolRegistry.register(this.calculatorTool);
    this.toolRegistry.register(this.knowledgeSearchTool);
  }
}
