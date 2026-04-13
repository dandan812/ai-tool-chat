import type { DraftImage, ImageData } from '../types/task'

const DB_NAME = 'ai-tool-chat'
const STORE_NAME = 'draft-images'
const DB_VERSION = 1
const DRAFT_REF_STORAGE_KEY = 'chat_draft_images_v1'

interface DraftImageRecord {
  id: string
  blob: Blob
  mimeType: string
  description?: string
  createdAt: number
}

interface StoredDraftImageRef {
  id: string
  draftKey: string
  mimeType: string
  description?: string
}

const fallbackStore = new Map<string, DraftImageRecord>()

function generateDraftId(): string {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function supportsIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!supportsIndexedDb()) {
    return Promise.resolve(null)
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase()
  if (!database) {
    throw new Error('IndexedDB unavailable')
  }

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)

    handler(store).then(resolve).catch(reject)

    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => database.close()
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

async function blobToImageData(record: DraftImageRecord): Promise<ImageData> {
  const dataUrl = await blobToDataUrl(record.blob)
  const base64 = dataUrl.split(',')[1] || ''

  return {
    id: record.id,
    base64,
    mimeType: record.mimeType,
    description: record.description,
  }
}

async function putRecord(record: DraftImageRecord): Promise<void> {
  if (!supportsIndexedDb()) {
    fallbackStore.set(record.id, record)
    return
  }

  try {
    await withStore('readwrite', async (store) => {
      await new Promise<void>((resolve, reject) => {
        const request = store.put(record)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      return
    })
  } catch {
    fallbackStore.set(record.id, record)
  }
}

async function getRecord(id: string): Promise<DraftImageRecord | null> {
  if (fallbackStore.has(id)) {
    return fallbackStore.get(id) || null
  }

  if (!supportsIndexedDb()) {
    return null
  }

  try {
    return await withStore('readonly', async (store) => {
      return new Promise<DraftImageRecord | null>((resolve, reject) => {
        const request = store.get(id)
        request.onsuccess = () => resolve((request.result as DraftImageRecord | undefined) || null)
        request.onerror = () => reject(request.error)
      })
    })
  } catch {
    return null
  }
}

async function deleteRecord(id: string): Promise<void> {
  fallbackStore.delete(id)

  if (!supportsIndexedDb()) {
    return
  }

  try {
    await withStore('readwrite', async (store) => {
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(id)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      return
    })
  } catch {
    // 降级路径无需额外处理
  }
}

export async function saveDraftImage(file: File): Promise<DraftImage> {
  const id = generateDraftId()
  const record: DraftImageRecord = {
    id,
    blob: file,
    mimeType: file.type,
    description: file.name,
    createdAt: Date.now(),
  }

  await putRecord(record)

  return {
    id,
    draftKey: id,
    previewUrl: URL.createObjectURL(file),
    mimeType: file.type,
    description: file.name,
  }
}

function loadDraftRefMap(): Record<string, StoredDraftImageRef[]> {
  try {
    const raw = localStorage.getItem(DRAFT_REF_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as Record<string, StoredDraftImageRef[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveDraftRefMap(map: Record<string, StoredDraftImageRef[]>): void {
  localStorage.setItem(DRAFT_REF_STORAGE_KEY, JSON.stringify(map))
}

function toStoredDraft(image: DraftImage): StoredDraftImageRef {
  return {
    id: image.id,
    draftKey: image.draftKey,
    mimeType: image.mimeType,
    description: image.description,
  }
}

export async function resolveDraftImage(draft: DraftImage): Promise<ImageData> {
  const record = await getRecord(draft.draftKey)
  if (!record) {
    throw new Error('草稿图片已丢失，请重新添加')
  }

  return blobToImageData(record)
}

export async function removeDraftImage(draftKey: string, previewUrl?: string): Promise<void> {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl)
  }
  await deleteRecord(draftKey)
}

export async function clearDraftImages(images: DraftImage[]): Promise<void> {
  await Promise.all(images.map((image) => removeDraftImage(image.draftKey, image.previewUrl)))
}

export function syncDraftImageRefs(sessionId: string, images: DraftImage[]): void {
  const nextMap = loadDraftRefMap()
  if (images.length === 0) {
    delete nextMap[sessionId]
  } else {
    nextMap[sessionId] = images.map(toStoredDraft)
  }
  saveDraftRefMap(nextMap)
}

export async function loadDraftImages(sessionId: string): Promise<DraftImage[]> {
  const refs = loadDraftRefMap()[sessionId] || []
  const results = await Promise.all(
    refs.map(async (draftRef) => {
      const record = await getRecord(draftRef.draftKey)
      if (!record) {
        return null
      }

      return {
        ...draftRef,
        previewUrl: URL.createObjectURL(record.blob),
      } satisfies DraftImage
    }),
  )

  return results.filter((item): item is DraftImage => !!item)
}

export function revokeDraftPreviews(images: DraftImage[]): void {
  for (const image of images) {
    URL.revokeObjectURL(image.previewUrl)
  }
}
