import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RetrievalHistoryMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4_000)
  content: string;
}

export class RetrievalDebugDto {
  @IsNotEmpty({ message: '检索问题不能为空' })
  @IsString()
  query: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  topK?: number = 5;

  @IsOptional()
  @IsIn(['vector_baseline', 'dual_recall', 'hybrid_rrf'])
  strategy?: 'vector_baseline' | 'dual_recall' | 'hybrid_rrf' =
    'vector_baseline';

  @IsOptional()
  @IsIn(['never', 'auto', 'always'])
  rewriteMode?: 'never' | 'auto' | 'always';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => RetrievalHistoryMessageDto)
  history?: RetrievalHistoryMessageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  summary?: string;
}
