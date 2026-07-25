import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RetrievalDebugDto {
  @IsNotEmpty({ message: '检索问题不能为空' })
  @IsString()
  query: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  topK?: number = 5;
}
