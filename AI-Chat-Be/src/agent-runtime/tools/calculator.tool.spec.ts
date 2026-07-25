import { AgentContext } from '../contracts';
import { CalculatorTool } from './calculator.tool';

describe('CalculatorTool', () => {
  const tool = new CalculatorTool();
  const context: AgentContext = {
    userId: 42,
    chatId: 'chat-id',
    generationId: 'generation-id',
  };

  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['-2 * (3 + 4)', -14],
    ['.5 + 1.25', 1.75],
  ])('evaluates %s with operator precedence', async (expression, expected) => {
    await expect(tool.execute({ expression }, context)).resolves.toEqual({
      expression,
      result: expected,
    });
  });

  it.each([
    ['1 / 0', '除数不能为零'],
    ['(1 + 2', '括号不匹配'],
    ['Math.random()', '表达式包含不支持的字符'],
    ['1..2', '无法解析表达式位置'],
  ])('rejects unsafe or invalid expression %s', async (expression, message) => {
    await expect(tool.execute({ expression }, context)).rejects.toThrow(message);
  });
});
