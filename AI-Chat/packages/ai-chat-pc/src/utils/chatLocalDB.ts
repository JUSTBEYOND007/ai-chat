import type { MessageProps } from '@pc/store/useChatStore'

const DB_NAME = 'ai-chat-local-db'
const DB_VERSION = 1
const MESSAGE_STORE = 'messages'
const PENDING_STORE = 'pendingMessages'

export type PendingMessageStatus = 'pending' | 'sent' | 'failed'

export type PendingMessageRecord = {
  clientMessageId: string
  chatId: string
  content: string
  fileId?: string
  knowledgeBaseId?: string
  status: PendingMessageStatus
  createdAt: number
  updatedAt: number
  retryCount: number
}

export type LocalMessageRecord = {
  id: string
  chatId: string
  message: MessageProps
  createdAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

const isIndexedDBAvailable = () => typeof indexedDB !== 'undefined'

const openChatDB = () => {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available'))
  }

  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(MESSAGE_STORE)) {
        const messageStore = db.createObjectStore(MESSAGE_STORE, {
          keyPath: 'id'
        })
        messageStore.createIndex('chatId', 'chatId', {
          unique: false
        })
      }

      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        const pendingStore = db.createObjectStore(PENDING_STORE, {
          keyPath: 'clientMessageId'
        })
        pendingStore.createIndex('status', 'status', {
          unique: false
        })
        pendingStore.createIndex('chatId', 'chatId', {
          unique: false
        })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(request.error)
    }
  })

  return dbPromise
}

const runStore = async <T>(
  storeName: typeof MESSAGE_STORE | typeof PENDING_STORE,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T> | void
) => {
  const db = await openChatDB()

  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = executor(store)

    if (request) {
      request.onsuccess = () => {
        resolve(request.result)
      }

      request.onerror = () => {
        reject(request.error)
      }
    }

    transaction.oncomplete = () => {
      if (!request) {
        resolve(undefined)
      }
    }

    transaction.onerror = () => {
      reject(transaction.error)
    }
  })
}

const getAllFromIndex = async <T>(
  storeName: typeof MESSAGE_STORE | typeof PENDING_STORE,
  indexName: string,
  value: IDBValidKey
) => {
  const db = await openChatDB()

  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const index = store.index(indexName)
    const request = index.getAll(value)

    request.onsuccess = () => {
      resolve(request.result as T[])
    }

    request.onerror = () => {
      reject(request.error)
    }
  })
}

const safeRun = async <T>(task: () => Promise<T>, fallback: T) => {
  try {
    return await task()
  } catch (error) {
    console.warn('Local chat database operation failed:', error)
    return fallback
  }
}

export const chatLocalDB = {
  createClientMessageId() {
    return `cm_${Date.now()}_${crypto.randomUUID()}`
  },

  saveMessage(chatId: string, message: MessageProps) {
    const createdAt = message.createdAt || Date.now()
    const id = message.clientMessageId || message.id || crypto.randomUUID()

    return safeRun(
      () =>
        runStore<IDBValidKey>(MESSAGE_STORE, 'readwrite', (store) =>
          store.put({
            id,
            chatId,
            message: {
              ...message,
              id,
              createdAt
            },
            createdAt
          })
        ),
      undefined
    )
  },

  getMessages(chatId: string) {
    return safeRun(async () => {
      const records = await getAllFromIndex<LocalMessageRecord>(MESSAGE_STORE, 'chatId', chatId)
      return records
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((record) => record.message)
    }, [] as MessageProps[])
  },

  savePendingMessage(record: Omit<PendingMessageRecord, 'status' | 'updatedAt' | 'retryCount'>) {
    return safeRun(
      () =>
        runStore<IDBValidKey>(PENDING_STORE, 'readwrite', (store) =>
          store.put({
            ...record,
            status: 'pending',
            updatedAt: Date.now(),
            retryCount: 0
          })
        ),
      undefined
    )
  },

  markPendingStatus(clientMessageId: string, status: PendingMessageStatus) {
    return safeRun(async () => {
      const record = await runStore<PendingMessageRecord>(
        PENDING_STORE,
        'readonly',
        (store) => store.get(clientMessageId)
      )

      if (!record) {
        return
      }

      await runStore<IDBValidKey>(PENDING_STORE, 'readwrite', (store) =>
        store.put({
          ...record,
          status,
          updatedAt: Date.now(),
          retryCount: status === 'failed' ? record.retryCount + 1 : record.retryCount
        })
      )
    }, undefined)
  },

  markMessageStatus(clientMessageId: string, status: PendingMessageStatus) {
    return safeRun(async () => {
      const record = await runStore<LocalMessageRecord>(
        MESSAGE_STORE,
        'readonly',
        (store) => store.get(clientMessageId)
      )

      if (!record) {
        return
      }

      await runStore<IDBValidKey>(MESSAGE_STORE, 'readwrite', (store) =>
        store.put({
          ...record,
          message: {
            ...record.message,
            sendStatus: status
          }
        })
      )
    }, undefined)
  },

  getRetryableMessages() {
    return safeRun(async () => {
      const pending = await getAllFromIndex<PendingMessageRecord>(
        PENDING_STORE,
        'status',
        'pending'
      )
      const failed = await getAllFromIndex<PendingMessageRecord>(PENDING_STORE, 'status', 'failed')

      return [...pending, ...failed].sort((a, b) => a.createdAt - b.createdAt)
    }, [] as PendingMessageRecord[])
  }
}
