import { useRef, useCallback } from 'react'
import type { UseMessageHeightReturn } from './types'

/**
 * 消息高度管理 Hook
 * 用于缓存和管理每条消息的高度
 */
export const useMessageHeight = (
  defaultHeight: number = 100
): UseMessageHeightReturn => {
  // 使用 Map 存储每条消息的高度
  const heightCache = useRef<Map<number, number>>(new Map())

  /**
   * 获取指定索引消息的高度
   */
  const getItemSize = useCallback(
    (index: number): number => {
      return heightCache.current.get(index) || defaultHeight
    },
    [defaultHeight]
  )

  /**
   * 设置指定索引消息的高度
   */
  const setItemSize = useCallback((index: number, size: number) => {
    const currentHeight = heightCache.current.get(index)
    
    // 只有高度变化时才更新，避免不必要的重新计算
    if (currentHeight !== size) {
      heightCache.current.set(index, size)
    }
  }, [])

  /**
   * 重置所有高度缓存
   */
  const resetHeights = useCallback(() => {
    heightCache.current.clear()
  }, [])

  return {
    getItemSize,
    setItemSize,
    resetHeights
  }
}
