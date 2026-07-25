# Streaming Reliability

Each answer generation receives a unique `generationId`. Every structured SSE event also receives a monotonically increasing `seq`. When a connection is interrupted, the client reconnects with `generationId` and `afterSeq`; the backend replays only events whose sequence is greater than `afterSeq`.

The browser keeps local messages and pending-send tasks in IndexedDB. A stable `clientMessageId` is sent with the user message. The backend checks this ID before creating a duplicate user message, which reduces duplicate sends after refresh, weak network recovery or retries.

Closing the browser-side EventSource only stops receiving data. It does not yet propagate an AbortSignal through the model and tool execution chain, so real server-side cancellation remains a later iteration.
