/**
 * 性能优化工具函数
 */

/**
 * 防抖函数
 * 在事件被触发n秒后再执行回调，如果在这n秒内又被触发，则重新计时
 * 
 * @param func 要执行的函数
 * @param wait 等待时间（毫秒）
 * @returns 防抖后的函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null

  return function (this: any, ...args: Parameters<T>) {
    const context = this

    if (timeout) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      func.apply(context, args)
      timeout = null
    }, wait)
  }
}

/**
 * 节流函数
 * 规定在一个单位时间内，只能触发一次函数。如果这个单位时间内触发多次函数，只有一次生效
 * 
 * @param func 要执行的函数
 * @param wait 等待时间（毫秒）
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  let previous = 0

  return function (this: any, ...args: Parameters<T>) {
    const context = this
    const now = Date.now()
    const remaining = wait - (now - previous)

    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      previous = now
      func.apply(context, args)
    } else if (!timeout) {
      timeout = setTimeout(() => {
        previous = Date.now()
        timeout = null
        func.apply(context, args)
      }, remaining)
    }
  }
}

/**
 * requestAnimationFrame 节流
 * 使用 RAF 实现的节流，确保在浏览器下一次重绘之前执行
 * 
 * @param func 要执行的函数
 * @returns 节流后的函数
 */
export function rafThrottle<T extends (...args: any[]) => any>(
  func: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null

  return function (this: any, ...args: Parameters<T>) {
    const context = this

    if (rafId !== null) {
      return
    }

    rafId = requestAnimationFrame(() => {
      func.apply(context, args)
      rafId = null
    })
  }
}

/**
 * 计算文本内容的预估高度
 * 用于虚拟滚动的初始高度估算
 * 
 * @param content 文本内容
 * @param baseHeight 基础高度
 * @returns 预估高度
 */
export function estimateTextHeight(content: string, baseHeight: number = 60): number {
  // 基础高度（头像、边距等）
  let height = baseHeight

  // 根据文本长度估算
  const lines = Math.ceil(content.length / 50) // 假设每行约50个字符
  height += lines * 24 // 每行约24px

  // 检查是否包含代码块
  const codeBlockCount = (content.match(/```/g) || []).length / 2
  if (codeBlockCount > 0) {
    height += codeBlockCount * 100 // 每个代码块额外增加高度
  }

  return Math.min(height, 1000) // 最大高度限制
}

/**
 * 检查元素是否在视口内
 * 
 * @param element DOM 元素
 * @param offset 偏移量
 * @returns 是否在视口内
 */
export function isInViewport(element: HTMLElement, offset: number = 0): boolean {
  const rect = element.getBoundingClientRect()
  return (
    rect.top >= -offset &&
    rect.left >= -offset &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + offset &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth) + offset
  )
}
