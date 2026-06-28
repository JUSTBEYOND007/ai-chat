import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BASE_URL } from 'src/constant';
import { isImageByExtension } from 'src/util';

@Injectable()
export class AiService {
  private openai: OpenAI;
  private defaultMessage = 'you are a helpful assistant';
  private textModel: string;
  private visionModel: string;

  constructor(private readonly configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('DASHSCOPE_API_KEY'),
      baseURL:
        this.configService.get<string>('DASHSCOPE_BASE_URL') ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    this.textModel =
      this.configService.get<string>('DASHSCOPE_TEXT_MODEL') ?? 'qwen-long';
    this.visionModel =
      this.configService.get<string>('DASHSCOPE_VISION_MODEL') ??
      'qwen-vl-plus';
  }

  private getLocalFilePath(filePath: string) {
    let localFilePath = filePath;

    if (filePath.startsWith(BASE_URL)) {
      localFilePath = filePath.replace(BASE_URL, '');
    }

    if (localFilePath.includes('/uploads/')) {
      localFilePath = localFilePath.slice(localFilePath.indexOf('/uploads/'));
    }

    if (localFilePath.startsWith('/uploads/')) {
      localFilePath = path.join(
        process.cwd(),
        localFilePath.replace(/^\//, ''),
      );
    } else if (localFilePath.startsWith('uploads/')) {
      localFilePath = path.join(process.cwd(), localFilePath);
    }

    return path.normalize(localFilePath);
  }

  private getImageMimeType(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
    };

    return mimeTypes[ext] ?? 'image/jpeg';
  }

  private getImageDataUrl(filePath: string) {
    const localFilePath = this.getLocalFilePath(filePath);
    const imageBuffer = fs.readFileSync(localFilePath);
    const mimeType = this.getImageMimeType(localFilePath);

    return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  }

  async getAiWithFile(filePath: string) {
    const localFilePath = this.getLocalFilePath(filePath);

    console.log('Converted local file path:', localFilePath);

    const fileObject = await this.openai.files.create({
      file: fs.createReadStream(localFilePath),
      // DashScope accepts OpenAI-compatible file extraction purpose.
      purpose: 'file-extract' as any,
    });

    return `fileid://${fileObject.id}`;
  }

  async getAiWithMessage() {}

  getAiWithImg(message: string, imgUrl: string) {
    const imgContent: {
      type: 'image_url';
      image_url: { url: string };
    } = {
      type: 'image_url',
      image_url: { url: imgUrl },
    };

    const messageContent: {
      type: 'text';
      text: string;
    } = {
      type: 'text',
      text: message,
    };

    return [messageContent, imgContent];
  }

  async getMain(message: string, filePath: string, imgUrl?: string[]) {
    const isImage = isImageByExtension(filePath);
    const model = isImage ? this.visionModel : this.textModel;

    const content =
      filePath && !isImage ? await this.getAiWithFile(filePath) : this.defaultMessage;

    const userContent = isImage
      ? this.getAiWithImg(
          message || '请描述这张图片',
          this.getImageDataUrl(filePath),
        )
      : message;

    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content },
        { role: 'user', content: userContent },
      ],
      stream: true,
      stream_options: {
        include_usage: true,
      },
    });

    return completion;
  }
}
