/**
 * Token调试工具
 */

import { useUserStore } from '@pc/store/useUserStore'

/**
 * 检查并清理token
 */
export const checkAndCleanToken = () => {
  console.group('🔍 Token检查')
  
  // 1. 检查localStorage
  const authStorage = localStorage.getItem('auth-storage')
  console.log('localStorage auth-storage:', authStorage)
  
  if (authStorage) {
    try {
      const parsed = JSON.parse(authStorage)
      console.log('解析后的数据:', parsed)
      
      const token = parsed.state?.token || parsed.token
      console.log('Token值:', token)
      
      if (token) {
        // 检查token格式
        const parts = token.split('.')
        console.log('Token部分数量:', parts.length, '(应该是3)')
        
        if (parts.length === 3) {
          try {
            // 解码payload
            const payload = JSON.parse(atob(parts[1]))
            console.log('Token payload:', payload)
            
            // 检查过期时间
            if (payload.exp) {
              const expDate = new Date(payload.exp * 1000)
              const now = new Date()
              console.log('Token过期时间:', expDate.toLocaleString())
              console.log('当前时间:', now.toLocaleString())
              console.log('是否过期:', now > expDate)
            }
          } catch (e) {
            console.error('解码token失败:', e)
          }
        } else {
          console.error('❌ Token格式错误，不是标准的JWT格式')
        }
      } else {
        console.warn('⚠️ 未找到token')
      }
    } catch (e) {
      console.error('解析localStorage失败:', e)
    }
  } else {
    console.log('localStorage中没有auth-storage')
  }
  
  console.groupEnd()
}

/**
 * 清除所有认证数据
 */
export const clearAllAuth = () => {
  console.log('🧹 清除所有认证数据...')
  
  // 清除localStorage
  localStorage.removeItem('auth-storage')
  
  // 清除store
  useUserStore.getState().logout()
  
  console.log('✅ 认证数据已清除')
}

/**
 * 手动设置token（用于测试）
 */
export const setTestToken = (token: string) => {
  console.log('🔧 设置测试token...')
  
  useUserStore.getState().login(
    {
      id: 1,
      userName: 'test',
      nickName: '测试用户',
      email: 'test@example.com'
    },
    token
  )
  
  console.log('✅ Token已设置')
  checkAndCleanToken()
}

// 开发环境下暴露到全局
if (process.env.NODE_ENV === 'development') {
  (window as any).tokenDebug = {
    check: checkAndCleanToken,
    clear: clearAllAuth,
    setToken: setTestToken
  }
  
  console.log('🔧 Token调试工具已加载到 window.tokenDebug')
  console.log('可用方法:')
  console.log('- tokenDebug.check(): 检查当前token')
  console.log('- tokenDebug.clear(): 清除所有认证数据')
  console.log('- tokenDebug.setToken(token): 设置测试token')
}