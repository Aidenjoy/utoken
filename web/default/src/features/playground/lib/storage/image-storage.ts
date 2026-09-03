import { DEFAULT_IMAGE_CONFIG, IMAGE_STORAGE_KEYS } from '../../constants'
import type { ImageConfig, ImageTask } from '../../types'

const MAX_STORED_IMAGE_TASKS = 50

// Inline base64 images are far too large for localStorage, so only remote URLs
// survive a refresh. A task whose images were all inline is marked as expired
// instead of silently rendering an empty gallery.
function isPersistableImage(src: string): boolean {
  return !!src && !src.startsWith('data:')
}

export function saveImageConfig(config: ImageConfig): void {
  try {
    // Reference images are always inline data URLs; never persist them.
    const filteredConfig: ImageConfig = { ...config, referenceImages: [] }
    localStorage.setItem(
      IMAGE_STORAGE_KEYS.IMAGE_CONFIG,
      JSON.stringify(filteredConfig)
    )
  } catch {
    // ignore storage errors
  }
}

export function getInitialImageConfig(): ImageConfig {
  try {
    const stored = localStorage.getItem(IMAGE_STORAGE_KEYS.IMAGE_CONFIG)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ImageConfig>
      return { ...DEFAULT_IMAGE_CONFIG, ...parsed, referenceImages: [] }
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_IMAGE_CONFIG }
}

export function saveImageTasks(tasks: ImageTask[]): void {
  try {
    const trimmed = tasks.slice(-MAX_STORED_IMAGE_TASKS).map((task) => {
      const images = task.images.filter((image) =>
        isPersistableImage(image.src)
      )
      return {
        ...task,
        images,
        referenceImages: [],
        imagesExpired: images.length < task.images.length,
      }
    })
    localStorage.setItem(
      IMAGE_STORAGE_KEYS.IMAGE_TASKS,
      JSON.stringify(trimmed)
    )
  } catch {
    // ignore storage errors
  }
}

export function loadImageTasks(): ImageTask[] {
  try {
    const stored = localStorage.getItem(IMAGE_STORAGE_KEYS.IMAGE_TASKS)
    if (stored) {
      const parsed = JSON.parse(stored) as ImageTask[]
      if (Array.isArray(parsed)) {
        // Completed tasks only: a pending task cannot resume, the request died with the page.
        return parsed
          .filter((task) => task.status !== 'pending')
          .sort((a, b) => a.createdAt - b.createdAt)
      }
    }
  } catch {
    // ignore parse errors
  }
  return []
}
