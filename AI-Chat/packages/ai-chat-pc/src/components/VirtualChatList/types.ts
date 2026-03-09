import type { CSSProperties } from 'react'
import type { MessageProps } from '@pc/store/useChatStore'

export interface VirtualChatListProps {
  messages: MessageProps[]
  height: number
  width?: string | number
  className?: string
}

export interface MessageItemProps {
  message: MessageProps
  index: number
  style: CSSProperties
  onHeightChange: (index: number, height: number) => void
}

export interface UseMessageHeightReturn {
  getItemSize: (index: number) => number
  setItemSize: (index: number, size: number) => void
  resetHeights: () => void
}
