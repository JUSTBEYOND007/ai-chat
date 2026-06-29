import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateKnowledgeBaseDto {
  @IsNotEmpty({ message: '知识库名称不能为空' })
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}