import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import type { CSSProperties } from 'react'

import { MessageItem } from './MessageItem'
import { useMessageHeight } from './useMessageHeight'
import type { VirtualChatListProps } from './types'
import { rafThrottle } from '@pc/utils/performance'

import './styles.css'

const BUFFER_SIZE = 4
const BOTTOM_THRESHOLD = 16
const BOTTOM_PADDING = 180

const getMessageKey = (
  message: VirtualChatListProps['messages'][number],
  index: number
) => {
  return message.clientMessageId || message.id || `${message.role}-${message.createdAt}-${index}`
}

export const VirtualChatList = ({
  messages,
  height,
  width = '100%',
  className = ''
}: VirtualChatListProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastMessageKeysRef = useRef<string>('')

  const [scrollTop, setScrollTop] = useState(0)
  const [isUserScrolling, setIsUserScrolling] = useState(false)

  const { getItemSize, setItemSize, resetHeights, heightsVersion } =
    useMessageHeight(120)

  const messageKeys = useMemo(
    () => messages.map((message, index) => getMessageKey(message, index)).join('|'),
    [messages]
  )

  useEffect(() => {
    if (lastMessageKeysRef.current && lastMessageKeysRef.current !== messageKeys) {
      resetHeights()
    }

    lastMessageKeysRef.current = messageKeys
  }, [messageKeys, resetHeights])

  const totalHeight = useMemo(() => {
    let total = 0
    for (let i = 0; i < messages.length; i++) {
      total += getItemSize(i)
    }
    return total
  }, [messages.length, getItemSize, heightsVersion])

  const getStartIndex = useCallback(() => {
    let sum = 0
    for (let i = 0; i < messages.length; i++) {
      const itemHeight = getItemSize(i)
      if (sum + itemHeight > scrollTop) {
        return Math.max(0, i - BUFFER_SIZE)
      }
      sum += itemHeight
    }

    return Math.max(0, messages.length - 1 - BUFFER_SIZE)
  }, [messages.length, scrollTop, getItemSize, heightsVersion])

  const getEndIndex = useCallback(() => {
    let sum = 0
    for (let i = 0; i < messages.length; i++) {
      sum += getItemSize(i)
      if (sum > scrollTop + height) {
        return Math.min(messages.length - 1, i + BUFFER_SIZE)
      }
    }

    return messages.length - 1
  }, [messages.length, scrollTop, height, getItemSize, heightsVersion])

  const getOffsetY = useCallback(
    (startIndex: number) => {
      let offset = 0
      for (let i = 0; i < startIndex; i++) {
        offset += getItemSize(i)
      }
      return offset
    },
    [getItemSize, heightsVersion]
  )

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) return

      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      setScrollTop(container.scrollTop)
    })
  }, [])

  const handleScrollThrottled = useMemo(
    () =>
      rafThrottle((nextScrollTop: number) => {
        setScrollTop(nextScrollTop)
      }),
    []
  )

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget
      handleScrollThrottled(target.scrollTop)
      setIsUserScrolling(true)

      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }

      userScrollTimeoutRef.current = setTimeout(() => {
        const isAtBottom =
          target.scrollHeight - target.scrollTop - target.clientHeight < BOTTOM_THRESHOLD

        if (isAtBottom) {
          setIsUserScrolling(false)
        }
      }, 500)
    },
    [handleScrollThrottled]
  )

  const handleHeightChange = useCallback(
    (index: number, itemHeight: number) => {
      setItemSize(index, itemHeight)

      if (index === messages.length - 1 && !isUserScrolling) {
        scrollToBottom()
      }
    },
    [messages.length, isUserScrolling, setItemSize, scrollToBottom]
  )

  useEffect(() => {
    if (!isUserScrolling && messages.length > 0) {
      scrollToBottom()
    }
  }, [messages.length, isUserScrolling, scrollToBottom])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    if (container.scrollTop > maxScrollTop) {
      container.scrollTop = maxScrollTop
      setScrollTop(maxScrollTop)
    }
  }, [totalHeight])

  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }
    }
  }, [])

  const startIndex = getStartIndex()
  const endIndex = getEndIndex()
  const offsetY = getOffsetY(startIndex)

  const visibleMessages = useMemo(
    () => messages.slice(startIndex, endIndex + 1),
    [messages, startIndex, endIndex]
  )

  return (
    <div
      ref={containerRef}
      className={`virtual-chat-list ${className}`}
      style={{
        height,
        width,
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative'
      }}
      onScroll={handleScroll}>
      <div
        className="virtual-chat-list-spacer"
        style={{
          height: totalHeight + BOTTOM_PADDING,
          position: 'relative'
        }}>
        <div
          ref={contentRef}
          className="virtual-chat-list-window"
          style={{
            transform: `translateY(${offsetY}px)`
          }}>
          {visibleMessages.map((message, idx) => {
            const actualIndex = startIndex + idx
            const itemStyle: CSSProperties = {
              position: 'relative',
              width: '100%'
            }

            return (
              <MessageItem
                key={getMessageKey(message, actualIndex)}
                message={message}
                index={actualIndex}
                style={itemStyle}
                onHeightChange={handleHeightChange}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default VirtualChatList
