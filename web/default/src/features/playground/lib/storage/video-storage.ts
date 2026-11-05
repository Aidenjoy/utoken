import { DEFAULT_VIDEO_CONFIG, VIDEO_STORAGE_KEYS } from '../../constants'
import type { VideoConfig, VideoTask } from '../../types'

const MAX_STORED_VIDEO_TASKS = 50

/**
 * Return the current user's ID from localStorage (set by the auth layer).
 * Used to scope video-task storage per user so switching accounts does not
 * leave stale in-progress tasks that the new user cannot poll or cancel.
 */
function currentUserId(): string {
  try {
    return window.localStorage.getItem('uid') || '_anon'
  } catch {
    return '_anon'
  }
}

function videoTasksKey(): string {
  return `${VIDEO_STORAGE_KEYS.VIDEO_TASKS}:${currentUserId()}`
}

export function saveVideoConfig(config: VideoConfig): void {
  try {
    // Only persist media items that have been uploaded (have remoteUrl)
    // to avoid storing large base64 blobs in localStorage
    const filteredConfig: VideoConfig = {
      ...config,
      mediaItems: config.mediaItems.filter((item) => item.remoteUrl),
    }
    localStorage.setItem(
      VIDEO_STORAGE_KEYS.VIDEO_CONFIG,
      JSON.stringify(filteredConfig)
    )
  } catch {
    // ignore storage errors
  }
}

export function getInitialVideoConfig(): VideoConfig {
  try {
    const stored = localStorage.getItem(VIDEO_STORAGE_KEYS.VIDEO_CONFIG)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<VideoConfig>
      return { ...DEFAULT_VIDEO_CONFIG, ...parsed }
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_VIDEO_CONFIG }
}

export function saveVideoTasks(tasks: VideoTask[]): void {
  try {
    const trimmed = tasks.slice(0, MAX_STORED_VIDEO_TASKS)
    localStorage.setItem(videoTasksKey(), JSON.stringify(trimmed))
  } catch {
    // ignore storage errors
  }
}

export function loadVideoTasks(): VideoTask[] {
  try {
    const stored = localStorage.getItem(videoTasksKey())
    if (stored) {
      const parsed = JSON.parse(stored) as VideoTask[]
      if (Array.isArray(parsed)) {
        // Keep all tasks including in-progress ones so they survive refresh
        // Sort by createdAt ascending (oldest first, newest at bottom)
        return parsed.sort((a, b) => a.createdAt - b.createdAt)
      }
    }
  } catch {
    // ignore parse errors
  }
  return []
}

/**
 * Remove video tasks stored under the legacy (non-user-scoped) key.
 * Called once on mount to clean up stale data from before the fix.
 */
export function migrateLegacyVideoTasks(): void {
  try {
    localStorage.removeItem(VIDEO_STORAGE_KEYS.VIDEO_TASKS)
  } catch {
    // ignore
  }
}
