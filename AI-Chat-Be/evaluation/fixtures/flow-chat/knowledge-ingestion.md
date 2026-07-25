# Knowledge Ingestion

The current knowledge module accepts `.txt`, `.md`, `.markdown` and `.pdf` documents. The maximum uploaded knowledge document size is 20 MB. File extension and MIME type are checked before indexing, and local parsing is restricted to files inside the backend `uploads` directory.

Documents move through pending, parsing, indexed and failed states. A failed document can be retried. Before re-indexing or after a failed indexing attempt, old chunks are cleaned up to avoid leaving partial vector data.

Text is split with a chunk size of 1,000 characters and an overlap of 200 characters. Each non-empty chunk is embedded and stored in PostgreSQL. The current retrieval baseline orders chunks by pgvector cosine distance and only reads documents whose status is indexed.
