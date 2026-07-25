import { UserOutlined } from '@ant-design/icons'
import { Bubble } from '@ant-design/x'
import { Tag } from 'antd'
import { memo, useEffect, useRef } from 'react'
import type { GetProp } from 'antd'
import type { MessageItemProps } from './types'
import { allMessageContent } from '@pc/components/Bubble/content'
import type { MessageContent } from '@pc/types/chat'
import { AgentTrace } from './AgentTrace'

/**
 * 单条消息组件
 * 使用 memo 优化，只在消息内容变化时重新渲染
 * 
 * 性能优化点：
 * 1. React.memo 避免不必要的重渲染
 * 2. ResizeObserver 精确测量高度
 * 3. 高度缓存避免重复计算
 */
export const MessageItem = memo<MessageItemProps>(
  ({ message, index, style, onHeightChange }) => {
    const itemRef = useRef<HTMLDivElement>(null)
    const resizeObserverRef = useRef<ResizeObserver | null>(null)

    // 角色配置
    const rolesAsObject: GetProp<typeof Bubble.List, 'roles'> = {
      system: {
        placement: 'start',
        avatar: { icon: <UserOutlined />, style: { background: '#fde3cf' } },
        variant: 'borderless',
        style: {
          maxWidth: '100%'
        }
      },
      user: {
        placement: 'end',
        avatar: { icon: <UserOutlined />, style: { background: '#87d068' } },
        style: {
          maxWidth: '100%'
        }
      },
      file: {
        placement: 'end',
        variant: 'borderless',
        style: {
          maxWidth: '100%'
        }
      },
      image: {
        placement: 'end',
        variant: 'borderless',
        style: {
          maxWidth: '100%'
        }
      }
    }

    // 渲染消息内容
    const renderMessageContent = (content: MessageContent[]) => {
      if (!content || content.length === 0) {
        return null
      }

      return content.map((item, idx) => {
        return (
          <div key={idx}>
            {allMessageContent[item.type as keyof typeof allMessageContent](item as any)}
          </div>
        )
      })
    }

    // 测量并报告高度
    useEffect(() => {
      if (itemRef.current) {
        // 使用 ResizeObserver 监听高度变化
        resizeObserverRef.current = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const height = entry.target.getBoundingClientRect().height
            if (height > 0) {
              // 报告高度变化
              onHeightChange(index, height)
            }
          }
        })

        resizeObserverRef.current.observe(itemRef.current)

        return () => {
          if (resizeObserverRef.current) {
            resizeObserverRef.current.disconnect()
          }
        }
      }
    }, [index, onHeightChange])

    const roleConfig = rolesAsObject[message.role as keyof typeof rolesAsObject]
    const statusText =
      message.role === 'user' && message.sendStatus === 'pending'
        ? '发送中'
        : message.role === 'user' && message.sendStatus === 'failed'
          ? '发送失败，网络恢复后自动重试'
          : message.role === 'system' && message.streamStatus === 'interrupted'
            ? 'AI 回复中断，已保留当前内容，可在输入框上方重新生成'
            : ''

    return (
      <div
        ref={itemRef}
        className={`virtual-chat-list-item virtual-chat-list-item-${message.role}`}
        style={style}>
        {message.role === 'system' &&
        (message.agentSteps?.length || message.contextUsage) ? (
          <AgentTrace
            steps={message.agentSteps || []}
            contextUsage={message.contextUsage}
            isStreaming={message.streamStatus === 'streaming'}
          />
        ) : null}
        <Bubble
          placement={roleConfig?.placement}
          avatar={roleConfig?.avatar}
          variant={roleConfig?.variant}
          style={roleConfig?.style}
          content={renderMessageContent(message.content)}
        />
        {!message.agentSteps?.length && message.toolCalls?.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.toolCalls.map((toolCall, toolIndex) => (
              <Tag key={`${toolCall.name}-${toolIndex}`} color="blue">
                {toolCall.name}
                {typeof toolCall.resultCount === 'number'
                  ? ` · ${toolCall.resultCount} sources`
                  : ''}
              </Tag>
            ))}
          </div>
        ) : null}
        {message.sources?.length ? (
          <div className="mt-2 rounded border border-blue-100 bg-blue-50 p-2 text-xs text-slate-600">
            <div className="mb-1 font-medium text-blue-700">知识库引用</div>
            <div className="flex flex-col gap-1">
              {message.sources.map((source, sourceIndex) => (
                <div key={`${source.documentId}-${source.chunkIndex}-${sourceIndex}`}>
                  <span className="font-medium">{source.fileName}</span>
                  <span> · chunk {source.chunkIndex} · {source.score.toFixed(2)}</span>
                  <p className="m-0 line-clamp-2">{source.content}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {statusText && (
          <div
            className={`mt-1 text-xs text-right ${
              message.sendStatus === 'failed' || message.streamStatus === 'interrupted'
                ? 'text-orange-500'
                : 'text-gray-400'
            }`}>
            {statusText}
          </div>
        )}
      </div>
    )
  },
  // 自定义比较函数，只有消息内容变化时才重新渲染
  (prevProps, nextProps) => {
    return (
      prevProps.message === nextProps.message &&
      prevProps.index === nextProps.index
    )
  }
)

MessageItem.displayName = 'MessageItem'
