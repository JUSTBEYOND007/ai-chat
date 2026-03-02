/**
 * 调试工具 - 帮助检查应用状态
 */

import { useUserStore } from '@pc/store/useUserStore'
import { useConversationStore } from '@pc/store/useConversationStore'
import { useChatStore } from '@pc/store/useChatStore'
import { sessionApi } from '@pc/apis/session'
import { BASE_URL } from '@pc/constant'

// 检查用户登录状态
export const checkAuthStatus = () => {
  const { isAuthenticated, user, token, getTokenStatus } = useUserStore.getState()
  
  console.group('🔐 用户认证状态')
  console.log('已登录:', isAuthenticated)
  console.log('用户信息:', user)
  console.log('Token:', token ? '已设置' : '未设置')
  
  if (token) {
    const tokenStatus = getTokenStatus()
    console.log('Token状态:', tokenStatus)
  }
  
  console.groupEnd()
  
  return { isAuthenticated, user, token }
}

// 检查网络连接
export const checkNetworkConnection = async () => {
  console.group('🌐 网络连接检查')
  
  try {
    // 检查后端服务是否可达
    const response = await fetch(`${BASE_URL}/health`, { 
      method: 'GET',
      mode: 'cors'
    })
    
    console.log('后端服务状态:', response.status, response.statusText)
    
    if (response.ok) {
      console.log('✅ 后端服务正常')
    } else {
      console.log('⚠️ 后端服务异常')
    }
  } catch (error) {
    console.error('❌ 无法连接到后端服务:', error)
    
    // 尝试简单的ping测试
    try {
      await fetch(`${BASE_URL}`, { method: 'HEAD', mode: 'no-cors' })
      console.log('💡 后端服务可能存在但CORS配置有问题')
    } catch (pingError) {
      console.error('❌ 后端服务完全无法访问')
    }
  }
  
  console.groupEnd()
}

// 测试API请求
export const testApiRequest = async () => {
  console.group('🧪 API请求测试')
  
  try {
    console.log('测试获取用户会话列表...')
    const result = await sessionApi.getUserChats()
    console.log('✅ API请求成功:', result)
    return result
  } catch (error) {
    console.error('❌ API请求失败:', error)
    return null
  } finally {
    console.groupEnd()
  }
}

// 检查会话状态
export const checkConversationStatus = () => {
  const { selectedId, conversations, loading, error } = useConversationStore.getState()
  
  console.group('💬 会话状态')
  console.log('当前选中会话ID:', selectedId)
  console.log('会话列表:', conversations)
  console.log('加载中:', loading)
  console.log('错误信息:', error)
  console.groupEnd()
  
  return { selectedId, conversations, loading, error }
}

// 检查聊天消息状态
export const checkChatStatus = () => {
  const { messages } = useChatStore.getState()
  
  console.group('📝 聊天消息状态')
  console.log('消息Map:', messages)
  console.log('消息数量:', messages.size)
  
  // 遍历所有会话的消息
  messages.forEach((msgs, conversationId) => {
    console.log(`会话 ${conversationId} 的消息数量:`, msgs.length)
  })
  console.groupEnd()
  
  return { messages }
}

// 模拟登录（用于测试）
export const simulateLogin = () => {
  const userStore = useUserStore.getState()
  
  console.log('🔄 执行模拟登录...')
  
  // 使用新的login方法
  userStore.login(
    {
      id: 1,
      userName: 'admin',
      nickName: '管理者',
      email: 'admin@example.com'
    },
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyTmFtZSI6ImFkbWluIiwibmlja05hbWUiOiLnrqHnkIbogIUiLCJ1c2VySWQiOjEsImlhdCI6MTczNTIwNDk4MCwiZXhwIjoxNzM1ODA5NzgwfQ.test-token-for-debug'
  )
  
  console.log('✅ 模拟登录完成')
  return checkAuthStatus()
}

// 手动触发获取会话列表
export const fetchConversations = async () => {
  const conversationStore = useConversationStore.getState()
  
  console.log('🔄 开始获取会话列表...')
  try {
    await conversationStore.fetchConversations()
    console.log('✅ 会话列表获取成功')
    return checkConversationStatus()
  } catch (error) {
    console.error('❌ 会话列表获取失败:', error)
    return null
  }
}

// 添加测试消息
export const addTestMessages = () => {
  const { addMessage } = useChatStore.getState()
  const { selectedId } = useConversationStore.getState()
  
  if (!selectedId) {
    console.warn('⚠️ 没有选中的会话，无法添加测试消息')
    return
  }
  
  // 添加用户消息
  addMessage({
    content: [{
      type: 'text',
      content: '这是一条测试用户消息'
    }],
    role: 'user'
  })
  
  // 添加系统回复
  addMessage({
    content: [{
      type: 'text',
      content: '这是一条测试系统回复消息，用于验证虚拟滚动功能是否正常工作。'
    }],
    role: 'system'
  })
  
  console.log('✅ 测试消息已添加')
  return checkChatStatus()
}

// 清除所有数据并重新开始
export const resetAll = () => {
  console.log('🔄 重置所有数据...')
  
  // 清除用户状态
  useUserStore.getState().logout()
  
  // 清除会话状态
  useConversationStore.setState({
    selectedId: null,
    conversations: [],
    loading: false,
    error: null
  })
  
  // 清除聊天消息
  useChatStore.setState({
    messages: new Map()
  })
  
  // 清除localStorage
  localStorage.removeItem('auth-storage')
  
  console.log('✅ 所有数据已重置')
  
  // 刷新页面
  window.location.reload()
}

// 综合检查
export const debugAll = async () => {
  console.log('🔍 开始全面调试检查...')
  
  const authStatus = checkAuthStatus()
  await checkNetworkConnection()
  
  // 如果已登录，测试API请求
  if (authStatus.isAuthenticated) {
    await testApiRequest()
  }
  
  const conversationStatus = checkConversationStatus()
  const chatStatus = checkChatStatus()
  
  // 提供建议
  console.group('💡 调试建议')
  
  if (!authStatus.isAuthenticated) {
    console.log('1. 运行 simulateLogin() 来模拟登录')
  }
  
  if (conversationStatus.conversations.length === 0) {
    console.log('2. 运行 fetchConversations() 来获取会话列表')
  }
  
  if (chatStatus.messages.size === 0) {
    console.log('3. 运行 addTestMessages() 来添加测试消息')
  }
  
  console.log('4. 运行 resetAll() 来重置所有数据')
  
  console.groupEnd()
  
  return {
    auth: authStatus,
    conversations: conversationStatus,
    chat: chatStatus
  }
}

// 开发环境下暴露到全局
if (process.env.NODE_ENV === 'development') {
  (window as any).debugHelper = {
    checkAuthStatus,
    checkNetworkConnection,
    testApiRequest,
    checkConversationStatus,
    checkChatStatus,
    simulateLogin,
    fetchConversations,
    addTestMessages,
    resetAll,
    debugAll
  }
  
  console.log('🛠️ 调试工具已加载到 window.debugHelper')
  console.log('可用方法:')
  console.log('- debugAll(): 全面检查')
  console.log('- simulateLogin(): 模拟登录')
  console.log('- fetchConversations(): 获取会话列表')
  console.log('- addTestMessages(): 添加测试消息')
  console.log('- testApiRequest(): 测试API请求')
  console.log('- resetAll(): 重置所有数据')
}