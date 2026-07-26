import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Chat } from './chat.entity';

export enum MessageRole {
  USER = 'user',
  SYSTEM = 'system',
  ASSISTANT = 'assistant',
}

export interface FileContent {
  fileId: string;
  fileName: string;
  fileSize?: number;
}

export interface MessageSource {
  documentId: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  score: number;
}

export interface MessageToolCall {
  toolCallId?: string;
  name: string;
  status: 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: {
    code: string;
    message: string;
  };
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  query?: string;
  resultCount?: number;
}

export interface MessageAgentStep {
  stepId: string;
  type: 'planning' | 'tool' | 'answer';
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  round?: number;
  startedAt: number;
  completedAt?: number;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: {
    code: string;
    message: string;
  };
  durationMs?: number;
  message?: string;
}

export interface MessageContextUsage {
  inputBudgetTokens: number;
  responseReserveTokens: number;
  estimatedInputTokens: number;
  systemTokens: number;
  currentMessageTokens: number;
  summaryTokens: number;
  historyTokens: number;
  includedHistoryMessages: number;
  droppedHistoryMessages: number;
  truncatedHistoryMessages: number;
  toolResultBudgetTokens: number;
  usedSummary: boolean;
  summarizedMessageCount?: number;
  summaryUpdatedAt?: number;
  overBudget: boolean;
}

export enum MessageStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMED_OUT = 'timed_out',
}

@Entity()
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: MessageRole,
    default: MessageRole.USER,
  })
  role: MessageRole;

  @Column({
    type: 'text',
  })
  content: string;

  @Column({
    type: 'varchar',
    nullable: true,
  })
  clientMessageId?: string;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  knowledgeBaseId?: string;

  @Column({
    type: 'json',
    nullable: true,
  })
  sources?: MessageSource[];

  @Column({
    type: 'json',
    nullable: true,
  })
  toolCalls?: MessageToolCall[];

  @Column({
    type: 'json',
    nullable: true,
  })
  agentSteps?: MessageAgentStep[];

  @Column({
    type: 'json',
    nullable: true,
  })
  contextUsage?: MessageContextUsage;

  @Column({
    type: 'enum',
    enum: MessageStatus,
    default: MessageStatus.COMPLETED,
  })
  status: MessageStatus;

  @Column({
    type: 'json',
    nullable: true,
  })
  imgUrl: string[];

  @Column({
    type: 'json',
    nullable: true,
  })
  fileContent: FileContent[];

  @ManyToOne(() => Chat, (chat) => chat.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatId' })
  chat: Chat;

  @Column({
    type: 'uuid',
  })
  chatId: string;

  @CreateDateColumn()
  createdAt: Date;
}
