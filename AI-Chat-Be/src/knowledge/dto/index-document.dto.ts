import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class IndexDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  fileId?: string;

  @IsNotEmpty({ message: '文件名不能为空' })
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsNotEmpty({ message: '文件路径不能为空' })
  @IsString()
  filePath: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;
}