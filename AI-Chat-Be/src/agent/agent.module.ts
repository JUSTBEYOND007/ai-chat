import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { AiModule } from 'src/ai/ai.module';
import { RagService } from './services/rag.service';
import { MbtiService } from './services/mbti.service';
import { KnowledgeModule } from 'src/knowledge/knowledge.module';
import { AgentRuntimeModule } from 'src/agent-runtime/agent-runtime.module';

@Module({
  imports: [AiModule, KnowledgeModule, AgentRuntimeModule],
  controllers: [AgentController],
  providers: [AgentService, RagService, MbtiService],
  exports: [AgentService, RagService],
})
export class AgentModule {}
