/**
 * Outline (knowledge base) collection info
 */
export interface OutlineCollection {
  id: string
  name: string
  description?: string | null
  url?: string
  color?: string | null
}

/**
 * Outline document (markdown body in `text`)
 */
export interface OutlineDocument {
  id: string
  title: string
  text?: string
  url?: string
  urlId?: string
  collectionId?: string | null
  parentDocumentId?: string | null
  updatedAt?: string
  createdAt?: string
  archivedAt?: string | null
}
