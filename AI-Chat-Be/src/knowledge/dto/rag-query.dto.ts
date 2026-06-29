import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RagQueryDto {
  @IsNotEmpty({ message: '问题不能为空' })
  @IsString()
  query: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  topK?: number = 5;
}