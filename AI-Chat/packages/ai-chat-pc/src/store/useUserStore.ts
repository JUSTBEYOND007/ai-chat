import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { User } from '@pc/types/user'

type LoginUser = Omit<User, 'id'> & {
  id?: string | number
  userName?: string
}

interface TokenStatus {
  hasToken: boolean
  isValid: boolean
  isExpired: boolean
  expiresAt: string | null
  payload?: Record<string, unknown>
  reason?: string
}

// 认证状态接口
interface UserState {
  // 状态
  isAuthenticated: boolean
  user: User | null
  token: string | null
  loading: boolean
  error: string | null

  // 方法
  login: (user: LoginUser, token: string) => void
  logout: () => void
  getTokenStatus: () => TokenStatus
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void
}

const getPersistedUserState = () => {
  try {
    return JSON.parse(localStorage.getItem('auth-storage') || '{}')
  } catch {
    return {}
  }
}

const userState = getPersistedUserState()

// 创建持久化存储的认证状态
export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      // 初始状态
      isAuthenticated: userState.isAuthenticated || false,
      user: userState.user || null,
      token: userState.token || null,
      loading: false,
      error: null,

      // 方法
      login: (user, token) => {
        const { userName, ...restUser } = user
        const normalizedUser: User = {
          ...restUser,
          id: user.id === undefined ? undefined : String(user.id),
          username: restUser.username || userName
        }

        set({
          isAuthenticated: true,
          user: normalizedUser,
          token,
          loading: false,
          error: null
        })
      },
      logout: () =>
        set({
          isAuthenticated: false,
          user: null,
          token: null,
          loading: false,
          error: null
        }),
      getTokenStatus: () => {
        const token = get().token

        if (!token) {
          return {
            hasToken: false,
            isValid: false,
            isExpired: false,
            expiresAt: null,
            reason: 'missing'
          }
        }

        const parts = token.split('.')
        if (parts.length !== 3) {
          return {
            hasToken: true,
            isValid: false,
            isExpired: false,
            expiresAt: null,
            reason: 'invalid-format'
          }
        }

        try {
          const payload = JSON.parse(atob(parts[1])) as Record<string, unknown>
          const exp = typeof payload.exp === 'number' ? payload.exp : null
          const expiresAt = exp ? new Date(exp * 1000) : null
          const isExpired = expiresAt ? Date.now() > expiresAt.getTime() : false

          return {
            hasToken: true,
            isValid: true,
            isExpired,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            payload
          }
        } catch {
          return {
            hasToken: true,
            isValid: false,
            isExpired: false,
            expiresAt: null,
            reason: 'invalid-payload'
          }
        }
      },
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      clearError: () => set({ error: null })
    }),
    {
      name: 'auth-storage', // localStorage 的键名
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        token: state.token
      }) // 只持久化这些字段
    }
  )
)
