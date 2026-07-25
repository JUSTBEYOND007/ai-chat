# Flow-Chat Architecture

Flow-Chat is a front-end and back-end separated AI conversation platform. The PC client uses React, TypeScript, Zustand and Vite. The backend uses NestJS and TypeORM. Persistent business data is stored in PostgreSQL, vector retrieval uses pgvector, and Redis is reserved for stream state, queues and cache-oriented capabilities.

The core business modules are users, chats, messages, files and knowledge bases. JWT guards protect authenticated APIs. Knowledge bases are isolated by user ownership, so a user cannot retrieve or debug another user's private knowledge base.

The project prioritizes an explainable Agentic RAG loop: model tool calling, structured SSE events, controllable context, trace persistence and measurable retrieval quality.
