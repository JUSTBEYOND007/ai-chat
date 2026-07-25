import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentContext, AgentTool } from '../contracts';

export const calculatorInputSchema = z.object({
  expression: z.string().trim().min(1).max(200),
});

export interface CalculatorOutput {
  expression: string;
  result: number;
}

@Injectable()
export class CalculatorTool
  implements AgentTool<typeof calculatorInputSchema, CalculatorOutput>
{
  readonly name = 'calculator';
  readonly description =
    '计算仅包含数字、括号、加减乘除的小型数学表达式。';
  readonly schema = calculatorInputSchema;
  readonly timeoutMs = 1_000;

  async execute(
    input: z.infer<typeof calculatorInputSchema>,
    _context: AgentContext,
  ): Promise<CalculatorOutput> {
    const result = new SafeExpressionParser(input.expression).parse();
    if (!Number.isFinite(result)) {
      throw new Error('计算结果不是有限数字');
    }

    return {
      expression: input.expression,
      result,
    };
  }
}

class SafeExpressionParser {
  private position = 0;

  constructor(private readonly expression: string) {
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      throw new Error('表达式包含不支持的字符');
    }
  }

  parse() {
    const result = this.parseExpression();
    this.skipWhitespace();
    if (this.position !== this.expression.length) {
      throw new Error(`无法解析表达式位置: ${this.position + 1}`);
    }
    return result;
  }

  private parseExpression(): number {
    let value = this.parseTerm();

    while (true) {
      this.skipWhitespace();
      if (this.consume('+')) {
        value += this.parseTerm();
      } else if (this.consume('-')) {
        value -= this.parseTerm();
      } else {
        return value;
      }
    }
  }

  private parseTerm(): number {
    let value = this.parseFactor();

    while (true) {
      this.skipWhitespace();
      if (this.consume('*')) {
        value *= this.parseFactor();
      } else if (this.consume('/')) {
        const divisor = this.parseFactor();
        if (divisor === 0) {
          throw new Error('除数不能为零');
        }
        value /= divisor;
      } else {
        return value;
      }
    }
  }

  private parseFactor(): number {
    this.skipWhitespace();

    if (this.consume('+')) {
      return this.parseFactor();
    }
    if (this.consume('-')) {
      return -this.parseFactor();
    }
    if (this.consume('(')) {
      const value = this.parseExpression();
      this.skipWhitespace();
      if (!this.consume(')')) {
        throw new Error('括号不匹配');
      }
      return value;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const start = this.position;
    let decimalPoints = 0;

    while (this.position < this.expression.length) {
      const char = this.expression[this.position];
      if (char === '.') {
        decimalPoints += 1;
        if (decimalPoints > 1) {
          break;
        }
        this.position += 1;
      } else if (/\d/.test(char)) {
        this.position += 1;
      } else {
        break;
      }
    }

    const rawNumber = this.expression.slice(start, this.position);
    if (!rawNumber || rawNumber === '.') {
      throw new Error(`缺少数字，位置: ${start + 1}`);
    }

    const value = Number(rawNumber);
    if (!Number.isFinite(value)) {
      throw new Error(`数字无效: ${rawNumber}`);
    }
    return value;
  }

  private skipWhitespace() {
    while (/\s/.test(this.expression[this.position] || '')) {
      this.position += 1;
    }
  }

  private consume(expected: string) {
    if (this.expression[this.position] !== expected) {
      return false;
    }
    this.position += 1;
    return true;
  }
}
