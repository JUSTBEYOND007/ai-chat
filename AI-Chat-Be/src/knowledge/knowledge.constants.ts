export const KNOWLEDGE_MAX_FILE_SIZE = 20 * 1024 * 1024;

export const KNOWLEDGE_SUPPORTED_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.pdf',
] as const;

const MIME_TYPES_BY_EXTENSION: Record<string, string[]> = {
  '.txt': ['text/plain', 'application/octet-stream'],
  '.md': [
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/octet-stream',
  ],
  '.markdown': [
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/octet-stream',
  ],
  '.pdf': ['application/pdf', 'application/x-pdf', 'application/octet-stream'],
};

export function getKnowledgeDocumentExtension(fileName: string): string {
  const normalizedFileName = (fileName || '').split('?')[0];
  const lastDotIndex = normalizedFileName.lastIndexOf('.');
  return lastDotIndex >= 0
    ? normalizedFileName.slice(lastDotIndex).toLowerCase()
    : '';
}

export function isKnowledgeDocumentMimeTypeAllowed(
  extension: string,
  mimeType?: string,
): boolean {
  if (!mimeType) {
    return true;
  }

  return MIME_TYPES_BY_EXTENSION[extension]?.includes(mimeType.toLowerCase()) ?? false;
}
