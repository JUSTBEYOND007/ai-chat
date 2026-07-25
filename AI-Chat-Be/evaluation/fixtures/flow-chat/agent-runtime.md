# Agent Runtime

The Agent runtime uses a Tool Registry to manage tool definitions and a unified Tool Executor to validate arguments and execute tools. The first two tools are `calculator` and `knowledge_search`. The model decides whether it should call a tool through OpenAI-compatible native tool calling.

The controlled loop allows at most three tool rounds by default and has a total timeout of 45 seconds. `MAX_TOOL_ROUNDS_EXCEEDED` represents repeated tool calls beyond the configured limit. `AGENT_TIMEOUT` represents the total execution timeout. Completed tool results and partial trace data are retained when a later model turn fails.

Structured events distinguish planning, tool start, tool completion, answer chunks, completion and errors. The frontend merges them into an Agent Trace timeline, while the backend persists trace steps with the assistant message so a refresh can restore the explanation path.
