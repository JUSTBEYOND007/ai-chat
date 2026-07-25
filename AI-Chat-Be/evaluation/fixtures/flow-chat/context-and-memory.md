# Context Budget and Summary Memory

The Context Builder combines the system prompt, optional summary memory, recent conversation history and the current user question. The default input budget is 12,000 estimated tokens, the response reserve is 2,000 tokens, the maximum recent history count is 20, and the tool result budget is 2,000 tokens.

Summary Memory is enabled per chat and isolated by scope. Ordinary chat uses one scope, while every selected knowledge base uses an independent scope. A summary from one knowledge base must not be injected into another knowledge base conversation.

By default, summary generation is considered after 16 eligible messages. It keeps the most recent 8 messages in original form and compresses earlier messages. The summary records `throughMessageId`, which allows incremental refresh and prevents repeatedly summarizing the same history range.
