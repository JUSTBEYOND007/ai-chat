import { useEffect } from 'react'
import { useParams } from 'react-router-dom'

import { sessionApi } from '@pc/apis/session'
import AIRichInput from '@pc/components/AIRichInput'
import { ChatBubble } from '@pc/components/Bubble/bubble'
import { useChatStore, useConversationStore } from '@pc/store'
import { chatLocalDB } from '@pc/utils/chatLocalDB'
import { mapChatHistoryToMessages } from '@pc/utils/chatMessageMapper'

const Home = () => {
  const { id } = useParams()
  const { mergeMessages, setMessages } = useChatStore()
  const { setSelectedId } = useConversationStore()

  useEffect(() => {
    if (!id) {
      setSelectedId(null)
      return
    }

    let ignore = false

    const loadChatHistory = async () => {
      setSelectedId(id)
      const { data } = await sessionApi.getChatHistory(id)

      if (!ignore) {
        setMessages(id, mapChatHistoryToMessages(data))
        const localMessages = await chatLocalDB.getMessages(id)
        mergeMessages(id, localMessages)
      }
    }

    loadChatHistory().catch((error) => {
      console.error('Failed to load chat history:', error)
    })

    return () => {
      ignore = true
    }
  }, [id, mergeMessages, setMessages, setSelectedId])

  return (
    <div className="p-4 h-screen relative flex flex-col items-center overflow-hidden">
      <ChatBubble></ChatBubble>
      <AIRichInput />
    </div>
  )
}

export default Home
