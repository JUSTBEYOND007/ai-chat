import type {
  KnowledgeSearchToolOutput,
  RetrievalFilterReason,
  RetrievalTrace
} from '@pc/types/chat'

type RetrievalTracePanelProps = {
  output: KnowledgeSearchToolOutput
}

const channelLabels: Record<string, string> = {
  vector: '向量召回',
  keyword: '关键词召回',
  fused: 'RRF 融合'
}

const filterLabels: Record<RetrievalFilterReason, string> = {
  below_score_threshold: '低于阈值',
  duplicate_chunk: '内容重复',
  adjacent_chunk: '相邻片段',
  document_quota_exceeded: '单文档配额',
  token_budget_exceeded: 'Token 预算',
  top_k_limit: 'TopK 限制'
}

const formatScore = (score: number) =>
  Number.isFinite(score) ? score.toFixed(score < 0.1 ? 4 : 3) : '-'

const isRetrievalTrace = (value: unknown): value is RetrievalTrace => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RetrievalTrace>
  return (
    typeof candidate.strategy === 'string' &&
    typeof candidate.originalQuery === 'string' &&
    typeof candidate.effectiveQuery === 'string' &&
    Array.isArray(candidate.candidates) &&
    Array.isArray(candidate.channels) &&
    Boolean(candidate.timings)
  )
}

export const getKnowledgeSearchOutput = (value: unknown): KnowledgeSearchToolOutput | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const output = value as Partial<KnowledgeSearchToolOutput>
  if (
    (output.code !== 'OK' && output.code !== 'NO_RELIABLE_CONTEXT') ||
    typeof output.query !== 'string' ||
    typeof output.effectiveQuery !== 'string' ||
    !Array.isArray(output.sources) ||
    !isRetrievalTrace(output.retrievalTrace)
  ) {
    return undefined
  }
  return output as KnowledgeSearchToolOutput
}

export const RetrievalTracePanel = ({ output }: RetrievalTracePanelProps) => {
  const trace = output.retrievalTrace
  const selectedCount = trace.candidates.filter((candidate) => candidate.selected).length
  const sortedCandidates = [...trace.candidates].sort((left, right) => {
    if (left.selected !== right.selected) return left.selected ? -1 : 1
    const leftRank =
      left.channels.find((channel) => channel.channel === 'fused')?.rank ??
      left.finalRank ??
      Number.MAX_SAFE_INTEGER
    const rightRank =
      right.channels.find((channel) => channel.channel === 'fused')?.rank ??
      right.finalRank ??
      Number.MAX_SAFE_INTEGER
    return leftRank - rightRank
  })

  return (
    <div className="retrieval-trace-panel">
      <div className="retrieval-trace-summary">
        <span className="retrieval-trace-strategy">{trace.strategy}</span>
        <span>
          采用 {selectedCount}/{trace.candidates.length} 个片段
        </span>
        <span>总耗时 {trace.timings.totalMs}ms</span>
        {output.code === 'NO_RELIABLE_CONTEXT' ? (
          <span className="retrieval-trace-unreliable">无可靠上下文</span>
        ) : null}
      </div>

      <div className="retrieval-trace-query">
        <span>原问题：{trace.originalQuery}</span>
        {trace.effectiveQuery !== trace.originalQuery ? (
          <span>检索问题：{trace.effectiveQuery}</span>
        ) : null}
        <span>
          Rewrite：{trace.rewrite.status} / {trace.rewrite.reason} · {trace.rewrite.durationMs}ms
        </span>
      </div>

      <div className="retrieval-trace-channels">
        {trace.channels.map((channel) => (
          <span
            key={channel.channel}
            className={`retrieval-channel retrieval-channel-${channel.status}`}>
            {channelLabels[channel.channel] || channel.channel}：{channel.status}
            {channel.status === 'completed' ? ` · ${channel.candidateCount} 条` : ''}
            {channel.durationMs > 0 ? ` · ${channel.durationMs}ms` : ''}
          </span>
        ))}
      </div>

      {trace.selection ? (
        <div className="retrieval-trace-selection">
          RRF k={trace.selection.rrfK} · 片段预算 {trace.selection.selectedTokens}/
          {trace.selection.tokenBudget} tokens · 单文档最多 {trace.selection.maxChunksPerDocument}{' '}
          条 · 相邻距离 {trace.selection.adjacentChunkDistance}
        </div>
      ) : null}

      <details className="retrieval-candidates">
        <summary>查看候选、排名与过滤原因</summary>
        <div className="retrieval-candidate-list">
          {sortedCandidates.map((candidate) => (
            <div
              key={candidate.candidateId}
              className={`retrieval-candidate${candidate.selected ? ' retrieval-candidate-selected' : ''}`}>
              <div className="retrieval-candidate-heading">
                <span>
                  {candidate.selected ? `采用 #${candidate.finalRank}` : '未采用'} ·{' '}
                  {candidate.fileName} · chunk {candidate.chunkIndex}
                </span>
                <span>{candidate.tokenCount ?? '-'} tokens</span>
              </div>
              <div className="retrieval-candidate-ranks">
                {candidate.channels.map((channel) => (
                  <span key={channel.channel}>
                    {channelLabels[channel.channel] || channel.channel} #{channel.rank} /{' '}
                    {formatScore(channel.score)}
                  </span>
                ))}
              </div>
              {candidate.filterReasons.length ? (
                <div className="retrieval-filter-reasons">
                  {candidate.filterReasons.map((reason) => (
                    <span key={reason}>{filterLabels[reason]}</span>
                  ))}
                </div>
              ) : null}
              <p>{candidate.content}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
