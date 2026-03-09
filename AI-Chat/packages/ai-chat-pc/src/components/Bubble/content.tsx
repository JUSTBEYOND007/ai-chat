import { Attachments } from '@ant-design/x'
import { Image } from 'antd'
import { memo, useMemo } from 'react'

import { renderMarkdown } from '@pc/utils/markdownSingleton'

import type { FileContent, ImageContent, TextContent, MessageContent } from '@pc/types/chat'
import type { ReactElement } from 'react'

// 定义内容处理器的类型映射
type ContentHandlers = {
  [K in MessageContent['type']]: (data: Extract<MessageContent, { type: K }>) => ReactElement
}

const imageContent = (data: ImageContent): ReactElement => {
  const { content } = data
  return <Image src={content}></Image>
}

const fileContent = (data: FileContent): ReactElement => {
  const { content } = data
  return <Attachments.FileCard item={content} />
}

type TextContentComponentProps = {
  data: TextContent
}

const TextContentComponent = memo(({ data }: TextContentComponentProps): ReactElement => {
  const { content } = data

  // useMemo keeps replacement processing stable for the same content.
  const processedHtml = useMemo(() => {
    const html = renderMarkdown(content)

    // 保持原有的代码块语言标签处理逻辑
    return html
      .replace(
        /<pre><code class="language-(\w+)">/g,
        '<pre data-lang="$1"><code class="language-$1">'
      )
      .replace(/<pre><code>/g, '<pre data-lang="text"><code>')
  }, [content])

  return <div className="markdown-content" dangerouslySetInnerHTML={{ __html: processedHtml }} />
})

TextContentComponent.displayName = 'TextContentComponent'

const textContent = (data: TextContent): ReactElement => <TextContentComponent data={data} />

export const allMessageContent: ContentHandlers = {
  image: imageContent,
  file: fileContent,
  text: textContent
}
