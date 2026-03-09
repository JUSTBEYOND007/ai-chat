import markdownit from 'markdown-it'
import hljs from 'markdown-it-highlightjs'

// Module-level singleton: markdown-it instance is created only once.
const markdownInstance = markdownit({
  html: true,
  breaks: true
}).use(hljs)

// Cache rendered html by original markdown content.
const markdownCache = new Map<string, string>()

export const getMarkdownInstance = () => markdownInstance

export const renderMarkdown = (content: string): string => {
  const cached = markdownCache.get(content)
  if (cached !== undefined) {
    return cached
  }

  const rendered = markdownInstance.render(content)
  markdownCache.set(content, rendered)

  return rendered
}
