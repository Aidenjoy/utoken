import {
  DEFAULT_VIDEO_CONFIG,
  VIDEO_STORAGE_KEYS,
} from '../../constants'
import type { VideoConfig, VideoTask } from '../../types'

const MAX_STORED_VIDEO_TASKS = 50

export function saveVideoConfig(config: VideoConfig): void {
  try {
    localStorage.setItem(
      VIDEO_STORAGE_KEYS.VIDEO_CONFIG,
      JSON.stringify(config)
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
    localStorage.setItem(
      VIDEO_STORAGE_KEYS.VIDEO_TASKS,
      JSON.stringify(trimmed)
    )
  } catch {
    // ignore storage errors
  }
}

export function loadVideoTasks(): VideoTask[] {
  try {
    const stored = localStorage.getItem(VIDEO_STORAGE_KEYS.VIDEO_TASKS)
    if (stored) {
      const parsed = JSON.parse(stored) as VideoTask[]
      if (Array.isArray(parsed)) {
        // Keep all tasks including in-progress ones so they survive refresh
        return parsed
      }
    }
  } catch {
    // ignore parse errors
  }
  return []
}
