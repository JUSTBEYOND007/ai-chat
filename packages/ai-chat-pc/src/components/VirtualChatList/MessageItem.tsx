import { UserOutlined } from '@ant-design/icons'
import { Bubble } from '@ant-design/x'
import { memo, useEffect, useRef } from 'react'
import type { GetProp } from 'antd'
import type { MessageItemProps } from './types'
import { allMessageContent } from '@pc/components/Bubble/content'
import type { MessageContent } from '@pc/types/chat'

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
        avatar: { icon: <UserOutlined />, style: { background: '#87d068' } }
      },
      file: {
        placement: 'end',
        variant: 'borderless'
      },
      image: {
        placement: 'end',
        variant: 'borderless'
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
            const height = entry.contentRect.height
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

    return (
      <div ref={itemRef} style={style}>
        <Bubble
          placement={roleConfig?.placement}
          avatar={roleConfig?.avatar}
          variant={roleConfig?.variant}
          style={roleConfig?.style}
          content={renderMessageContent(message.content)}
        />
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
