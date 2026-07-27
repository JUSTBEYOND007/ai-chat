import { useMemo, useState } from 'react'
import type { ChatAgentStep, ChatContextUsage } from '@pc/types/chat'
import { getKnowledgeSearchOutput, RetrievalTracePanel } from './RetrievalTracePanel'

type AgentTraceProps = {
  steps: ChatAgentStep[]
  contextUsage?: ChatContextUsage
  isStreaming?: boolean
}

const formatDuration = (durationMs?: number) => {
  if (typeof durationMs !== 'number') {
    return ''
  }
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
}

const stringifyPreview = (value: unknown) => {
  if (typeof value === 'undefined') {
    return ''
  }

  try {
    const content = JSON.stringify(value, null, 2)
    return content.length > 2000 ? `${content.slice(0, 2000)}\n…` : content
  } catch {
    return String(value)
  }
}

const getStepTitle = (step: ChatAgentStep) => {
  if (step.type === 'planning') {
    return `第 ${step.round || 1} 轮分析`
  }
  if (step.type === 'tool') {
    return `调用 ${step.toolName || '工具'}`
  }
  return '生成最终回答'
}

const getStepStatusText = (step: ChatAgentStep) => {
  if (step.status === 'running') return '进行中'
  if (step.status === 'cancelled') return '已取消'
  if (step.status === 'interrupted') return '已中断'
  if (step.status === 'failed') return '失败'
  if (step.status === 'completed') return '完成'
  return '等待中'
}

const getToolOutputSummary = (step: ChatAgentStep) => {
  if (!step.output || typeof step.output !== 'object') {
    return undefined
  }

  const output = step.output as Record<string, unknown>

  if (Array.isArray(output.sources)) {
    return `命中 ${output.sources.length} 个知识片段`
  }

  if ('result' in output) {
    return `计算结果：${String(output.result)}`
  }

  return undefined
}

export const AgentTrace = ({ steps, contextUsage, isStreaming = false }: AgentTraceProps) => {
  const [expanded, setExpanded] = useState(true)
  const summary = useMemo(() => {
    const toolCount = steps.filter((step) => step.type === 'tool').length
    const failed = steps.some((step) => step.status === 'failed')
    const interrupted = steps.some(
      (step) => step.status === 'interrupted' || step.status === 'cancelled'
    )
    const running = steps.some((step) => step.status === 'running')
    const durationMs = steps.reduce((total, step) => total + (step.durationMs || 0), 0)

    return {
      toolCount,
      durationMs,
      status: failed
        ? 'failed'
        : interrupted
          ? 'interrupted'
          : running || isStreaming
            ? 'running'
            : 'completed'
    }
  }, [isStreaming, steps])
  const headerTitle =
    summary.status === 'running'
      ? 'Agent 正在执行'
      : summary.status === 'failed'
        ? 'Agent 执行异常'
        : summary.status === 'interrupted'
          ? 'Agent 执行已中断'
          : 'Agent 执行过程'

  return (
    <section className={`agent-trace agent-trace-${summary.status}`}>
      <button
        type="button"
        className="agent-trace-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}>
        <span className="agent-trace-header-main">
          <span className="agent-trace-status-dot" />
          <span>{headerTitle}</span>
        </span>
        <span className="agent-trace-summary">
          {summary.toolCount > 0 ? `${summary.toolCount} 次工具调用` : '未调用工具'}
          {summary.durationMs > 0 ? ` · ${formatDuration(summary.durationMs)}` : ''}
          <span className="agent-trace-toggle">{expanded ? '收起' : '展开'}</span>
        </span>
      </button>

      {expanded ? (
        <div className="agent-trace-steps">
          {contextUsage ? (
            <div
              className={`agent-context-usage${contextUsage.overBudget ? ' agent-context-usage-warning' : ''}`}>
              <span>
                上下文约 {contextUsage.estimatedInputTokens.toLocaleString()} /{' '}
                {contextUsage.inputBudgetTokens.toLocaleString()} tokens
              </span>
              <span>
                历史 {contextUsage.includedHistoryMessages} 条
                {contextUsage.usedSummary
                  ? ` · 已使用 ${contextUsage.summarizedMessageCount || 0} 条消息的长期摘要`
                  : ''}
                {contextUsage.droppedHistoryMessages > 0
                  ? ` · 丢弃 ${contextUsage.droppedHistoryMessages} 条`
                  : ''}
                {contextUsage.truncatedHistoryMessages > 0
                  ? ` · 截断 ${contextUsage.truncatedHistoryMessages} 条`
                  : ''}
              </span>
            </div>
          ) : null}
          {steps.map((step) => {
            const outputSummary = getToolOutputSummary(step)
            const knowledgeSearchOutput = getKnowledgeSearchOutput(step.output)
            return (
              <div key={step.stepId} className={`agent-trace-step agent-trace-step-${step.status}`}>
                <span className="agent-trace-step-dot" />
                <div className="agent-trace-step-content">
                  <div className="agent-trace-step-heading">
                    <span>{getStepTitle(step)}</span>
                    <span className="agent-trace-step-meta">
                      {getStepStatusText(step)}
                      {step.durationMs !== undefined ? ` · ${formatDuration(step.durationMs)}` : ''}
                    </span>
                  </div>
                  {step.type !== 'answer' && step.message ? (
                    <div className="agent-trace-step-message">{step.message}</div>
                  ) : null}
                  {outputSummary ? (
                    <div className="agent-trace-output-summary">{outputSummary}</div>
                  ) : null}
                  {knowledgeSearchOutput ? (
                    <RetrievalTracePanel output={knowledgeSearchOutput} />
                  ) : null}
                  {step.type === 'tool' &&
                  (step.input !== undefined ||
                    (step.output !== undefined && !knowledgeSearchOutput) ||
                    step.error !== undefined) ? (
                    <details className="agent-trace-details">
                      <summary>查看参数与结果</summary>
                      {step.input !== undefined ? (
                        <div>
                          <div className="agent-trace-detail-label">输入</div>
                          <pre>{stringifyPreview(step.input)}</pre>
                        </div>
                      ) : null}
                      {step.output !== undefined && !knowledgeSearchOutput ? (
                        <div>
                          <div className="agent-trace-detail-label">输出</div>
                          <pre>{stringifyPreview(step.output)}</pre>
                        </div>
                      ) : null}
                      {step.error ? (
                        <div>
                          <div className="agent-trace-detail-label">错误</div>
                          <pre>{stringifyPreview(step.error)}</pre>
                        </div>
                      ) : null}
                    </details>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
