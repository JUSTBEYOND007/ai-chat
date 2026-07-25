import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';
import { FileModule } from 'src/file/file.module';
import { AiModule } from 'src/ai/ai.module';
import { AgentRuntimeModule } from 'src/agent-runtime/agent-runtime.module';
import { ChatMemoryService } from './services/chat-memory.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chat, Message]),
    FileModule,
    AiModule,
    AgentRuntimeModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatMemoryService],
})
export class ChatModule {}
