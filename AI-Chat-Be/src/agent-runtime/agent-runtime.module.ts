import { Module } from '@nestjs/common';
import { KnowledgeModule } from 'src/knowledge/knowledge.module';
import { ToolExecutor } from './executor/tool-executor.service';
import { ToolRegistry } from './registry/tool-registry.service';
import { ToolRegistrationService } from './tool-registration.service';
import { CalculatorTool } from './tools/calculator.tool';
import { KnowledgeSearchTool } from './tools/knowledge-search.tool';
import { OpenAICompatibleAgentModel } from './adapters/openai-compatible-agent-model.service';
import { AgentRunner } from './runner/agent-runner.service';
import { AgentContextBuilder } from './context/agent-context-builder.service';

@Module({
  imports: [KnowledgeModule],
  providers: [
    ToolRegistry,
    ToolExecutor,
    CalculatorTool,
    KnowledgeSearchTool,
    ToolRegistrationService,
    OpenAICompatibleAgentModel,
    AgentContextBuilder,
    AgentRunner,
  ],
  exports: [
    ToolRegistry,
    ToolExecutor,
    CalculatorTool,
    KnowledgeSearchTool,
    OpenAICompatibleAgentModel,
    AgentContextBuilder,
    AgentRunner,
  ],
})
export class AgentRuntimeModule {}
