import type { AgentStreamEvent, ChatAgentStep } from '@pc/types/chat'

const upsertStep = (steps: ChatAgentStep[], step: ChatAgentStep) => {
  const index = steps.findIndex((item) => item.stepId === step.stepId)
  if (index < 0) {
    return [...steps, step]
  }

  const nextSteps = [...steps]
  nextSteps[index] = {
    ...nextSteps[index],
    ...step
  }
  return nextSteps
}

const completePlanningStep = (
  steps: ChatAgentStep[],
  generationId: string,
  round: number,
  completedAt: number,
  message: string
) => {
  const stepId = `${generationId}:planning:${round}`
  const planningStep = steps.find((step) => step.stepId === stepId)
  if (!planningStep || planningStep.status !== 'running') {
    return steps
  }

  return upsertStep(steps, {
    ...planningStep,
    status: 'completed',
    completedAt,
    durationMs: Math.max(0, completedAt - planningStep.startedAt),
    message
  })
}

export const reduceAgentSteps = (
  currentSteps: ChatAgentStep[] = [],
  event: AgentStreamEvent
): ChatAgentStep[] => {
  if (event.type === 'generation_start') {
    return currentSteps
  }

  if (event.type === 'planning') {
    return upsertStep(currentSteps, {
      stepId: `${event.generationId}:planning:${event.round}`,
      type: 'planning',
      status: event.status,
      round: event.round,
      startedAt: event.startedAt,
      completedAt: event.status === 'running' ? undefined : event.timestamp,
      durationMs: event.durationMs,
      error: event.error,
      message:
        event.message ||
        (event.status === 'running'
          ? `第 ${event.round} 轮：正在分析下一步`
          : `第 ${event.round} 轮分析完成`)
    })
  }

  if (event.type === 'tool_start') {
    const steps = completePlanningStep(
      currentSteps,
      event.generationId,
      event.round,
      event.timestamp,
      '模型已选择工具'
    )
    return upsertStep(steps, {
      stepId: `${event.generationId}:tool:${event.toolCallId}`,
      type: 'tool',
      status: 'running',
      round: event.round,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: event.input,
      startedAt: event.timestamp,
      message: `${event.toolName} 执行中`
    })
  }

  if (event.type === 'tool_result') {
    const { result } = event
    return upsertStep(currentSteps, {
      stepId: `${event.generationId}:tool:${result.toolCallId}`,
      type: 'tool',
      status: result.status,
      round: event.round,
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      input: result.input,
      output: result.output,
      error: result.error,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      message:
        result.status === 'completed'
          ? `${result.toolName} 执行完成`
          : result.error?.message || `${result.toolName} 执行失败`
    })
  }

  const latestPlanningRound = [...currentSteps]
    .reverse()
    .find((step) => step.type === 'planning' && step.status === 'running')?.round
  const steps = latestPlanningRound
    ? completePlanningStep(
        currentSteps,
        event.generationId,
        latestPlanningRound,
        event.timestamp,
        '最终回答已生成'
      )
    : currentSteps

  return upsertStep(steps, {
    stepId: `${event.generationId}:answer`,
    type: 'answer',
    status: 'completed',
    round: latestPlanningRound,
    startedAt: event.timestamp,
    completedAt: event.timestamp,
    durationMs: 0,
    message: '最终回答已生成'
  })
}

export const interruptAgentSteps = (
  steps: ChatAgentStep[] = [],
  error: { code: string; message: string } = {
    code: 'INTERRUPTED',
    message: '用户中断了本次生成'
  }
) => {
  const completedAt = Date.now()
  return steps.map((step) =>
    step.status === 'running'
      ? {
          ...step,
          status:
            error.code === 'INTERRUPTED'
              ? ('interrupted' as const)
              : ('failed' as const),
          completedAt,
          durationMs: Math.max(0, completedAt - step.startedAt),
          error,
          message: error.code === 'INTERRUPTED' ? '已中断' : error.message
        }
      : step
  )
}
