import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class SendMessageDto {
  @IsNotEmpty({
    message: 'id不能为空',
  })
  id: string;

  @IsNotEmpty({
    message: 'message不能为空',
  })
  message: string;

  imgUrl?: string[];

  fileId?: string;

  clientMessageId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'generationId格式不正确' })
  generationId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'knowledgeBaseId格式不正确' })
  knowledgeBaseId?: string;

  regenerate?: boolean;
}
