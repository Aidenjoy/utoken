import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { fetchVideoTask, submitVideoTask, uploadFile } from '../api'
import {
  AUDIO_MAX_DURATION,
  VIDEO_MAX_DURATION,
  VIDEO_POLL_INTERVAL_MS,
} from '../constants'
import {
  loadVideoTasks,
  saveVideoTasks,
} from '../lib/storage/video-storage'
import type {
  ArkContentItem,
  MediaItem,
  VideoConfig,
  VideoSubmitRequest,
  VideoTask,
  VideoTaskResponse,
} from '../types'

function mapStatus(status: string): VideoTask['status'] {
  switch (status?.toLowerCase()) {
    case 'queued':
    case 'submitted':
      return 'queued'
    case 'in_progress':
    case 'running':
      return 'in_progress'
    case 'completed':
    case 'success':
    case 'succeeded':
      return 'completed'
    case 'failed':
    case 'failure':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'in_progress'
  }
}

/**
 * Get media duration (seconds) by loading metadata in a temporary element.
 */
function getMediaDuration(
  url: string,
  type: 'video' | 'audio'
): Promise<number> {
  return new Promise((resolve, reject) => {
    const el =
      type === 'video'
        ? document.createElement('video')
        : document.createElement('audio')
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      const dur = el.duration
      if (isNaN(dur) || !isFinite(dur)) {
        reject(new Error('Could not determine media duration'))
      } else {
        resolve(dur)
      }
    }
    el.onerror = () => reject(new Error('Failed to load media metadata'))
    el.src = url
  })
}

/**
 * Generate a UUID, falling back to Math.random for non-secure contexts (HTTP).
 * crypto.randomUUID() is only available in secure contexts (HTTPS or localhost).
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Build the Volcano Ark official-protocol request body
// ({base}/api/v3/contents/generations/tasks) so the gateway can pass it
// through to upstream unchanged.
function buildSubmitPayload(
  config: VideoConfig,
  prompt: string
): VideoSubmitRequest {
  const content: ArkContentItem[] = [{ type: 'text', text: prompt }]

  if (config.mode === 'first_last_frame' || config.mode === 'first_frame') {
    // First/last frame and first frame modes: images are TOS URLs or base64 strings
    config.images.forEach((url, index) => {
      const role =
        config.mode === 'first_last_frame'
          ? index === 0
            ? 'first_frame'
            : 'last_frame'
          : 'first_frame'
      content.push({ type: 'image_url', image_url: { url }, role })
    })
  } else if (config.mode === 'reference') {
    // Reference mode: images, videos and audio uploaded to TOS
    for (const item of config.mediaItems) {
      const url = item.remoteUrl || item.url
      if (!url) {
        continue
      }
      if (item.type === 'image') {
        content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
      } else if (item.type === 'video') {
        content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' })
      } else if (item.type === 'audio') {
        content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })
      }
    }
  }
  // text_to_video: no media content needed

  const payload: VideoSubmitRequest = {
    model: config.model,
    content,
    generate_audio: config.audio,
    duration: config.duration,
    // Volcano Ark resolution enum is lowercase (480p/720p/1080p/4k)
    resolution: config.resolution.toLowerCase(),
    group: config.group,
  }
  if (config.ratio !== 'smart') {
    payload.ratio = config.ratio
  }

  return payload
}

export function useVideoHandler(config: VideoConfig) {
  const { t } = useTranslation()
  const [videoTasks, setVideoTasks] = useState<VideoTask[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  // Track upload progress: { [localUrl]: percent }
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTaskIdRef = useRef<string | null>(null)
  // A shared ID that groups all files uploaded for the same video task.
  // Used as the TOS folder name so all resources for one video are in one place.
  const batchIdRef = useRef<string>(generateUUID())

  // Load tasks from storage on mount and resume polling for active tasks
  useEffect(() => {
    const tasks = loadVideoTasks()
    setVideoTasks(tasks)
    // Resume polling for any task that was still in progress
    const activeTask = tasks.find(
      (t) => t.status === 'queued' || t.status === 'in_progress'
    )
    if (activeTask) {
      setIsGenerating(true)
      activeTaskIdRef.current = activeTask.taskId
      pollTimerRef.current = setTimeout(() => {
        pollTask(activeTask.taskId)
      }, VIDEO_POLL_INTERVAL_MS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist tasks to storage whenever they change
  const persistTasks = useCallback((tasks: VideoTask[]) => {
    saveVideoTasks(tasks)
  }, [])

  const updateTask = useCallback(
    (taskId: string, updater: (task: VideoTask) => VideoTask) => {
      setVideoTasks((prev) => {
        const next = prev.map((t) =>
          t.taskId === taskId ? updater(t) : t
        )
        persistTasks(next)
        return next
      })
    },
    [persistTasks]
  )

  const pollTask = useCallback(
    async (taskId: string) => {
      try {
        const resp: VideoTaskResponse = await fetchVideoTask(taskId)

        // If the task was cancelled while we were waiting for the response, stop polling
        if (activeTaskIdRef.current !== taskId) {
          console.log('[VideoTask] task was cancelled during poll, stopping')
          return
        }

        // eslint-disable-next-line no-console
        console.log('[VideoTask] poll response for', taskId, ':', resp)

        const status = mapStatus(resp.status)
        const videoUrl = resp.metadata?.url

        if (status === 'completed') {
          // eslint-disable-next-line no-console
          console.log('[VideoTask] task completed, videoUrl:', videoUrl)
          updateTask(taskId, (t) => ({
            ...t,
            status: 'completed',
            progress: 100,
            videoUrl: videoUrl ?? t.videoUrl,
            completedAt: resp.completed_at ?? Date.now(),
          }))
          setIsGenerating(false)
          activeTaskIdRef.current = null
          return
        }

        if (status === 'failed') {
          // eslint-disable-next-line no-console
          console.log('[VideoTask] task failed:', resp.error)
          const failMsg = resp.error?.message ?? 'Unknown error'
          updateTask(taskId, (t) => ({
            ...t,
            status: 'failed',
            progress: 100,
            error: failMsg,
            completedAt: Date.now(),
          }))
          setIsGenerating(false)
          activeTaskIdRef.current = null
          toast.error(t('Generation failed'), {
            description: failMsg,
          })
          return
        }

        // Still in progress - use ?? so 0 is a valid progress value
        updateTask(taskId, (t) => ({
          ...t,
          status,
          progress: resp.progress ?? t.progress,
        }))

        // Schedule next poll
        pollTimerRef.current = setTimeout(() => {
          pollTask(taskId)
        }, VIDEO_POLL_INTERVAL_MS)
      } catch (error) {
        // Network error - keep polling but log it
        // eslint-disable-next-line no-console
        console.warn('[VideoTask] poll error for', taskId, ':', error)
        // Don't schedule next poll if the task was cancelled
        if (activeTaskIdRef.current !== taskId) {
          return
        }
        pollTimerRef.current = setTimeout(() => {
          pollTask(taskId)
        }, VIDEO_POLL_INTERVAL_MS)
      }
    },
    [updateTask]
  )

  const submitVideo = useCallback(
    async (prompt: string) => {
      if (!config.model) {
        toast.error(t('Please select a model first'))
        return
      }

      // Mode-specific validation
      if (config.mode === 'text_to_video') {
        // Text-to-video: prompt is required
        if (!prompt.trim()) {
          toast.error(t('Please enter a prompt'))
          return
        }
      } else if (config.mode === 'reference') {
        // Reference mode: must have at least 1 image or video (not audio-only)
        const hasImageOrVideo = config.mediaItems.some(
          (item) => item.type === 'image' || item.type === 'video'
        )
        if (!hasImageOrVideo) {
          toast.error(t('Reference mode requires at least one image or video'))
          return
        }
        // Ensure all media items are uploaded
        const pendingUploads = config.mediaItems.filter(
          (item) =>
            (item.type === 'image' || item.type === 'video' || item.type === 'audio') &&
            !item.remoteUrl
        )
        if (pendingUploads.length > 0) {
          toast.error(t('Please wait for all media uploads to complete'))
          return
        }
      } else if (config.mode === 'first_last_frame' || config.mode === 'first_frame') {
        // First/last frame and first frame modes: must have at least 1 image
        if (config.images.length === 0) {
          toast.error(t('Please upload at least one image'))
          return
        }
      }

      // Check for ongoing uploads
      if (Object.keys(uploadProgress).length > 0) {
        toast.error(t('Please wait for all media uploads to complete'))
        return
      }

      const payload = buildSubmitPayload(config, prompt)

      // Log the submit payload for debugging (truncate media URLs)
      const logPayload = {
        ...payload,
        content: payload.content.map((item) => {
          const truncated = { ...item }
          for (const key of ['image_url', 'video_url', 'audio_url'] as const) {
            const media = truncated[key]
            if (media && media.url.length > 100) {
              truncated[key] = { url: media.url.substring(0, 80) + '...(truncated)' }
            }
          }
          return truncated
        }),
      }
      // eslint-disable-next-line no-console
      console.log('[VideoTask] Submit payload:', logPayload)

      try {
        setIsGenerating(true)
        const resp = await submitVideoTask(payload)

        // eslint-disable-next-line no-console
        console.log('[VideoTask] Submit response:', resp)

        const taskId = resp.id || resp.task_id || ''
        if (!taskId) {
          toast.error(t('Failed to submit video task'))
          setIsGenerating(false)
          return
        }

        const newTask: VideoTask = {
          taskId,
          status: 'queued',
          progress: 0,
          model: config.model,
          prompt,
          images: config.mode === 'first_last_frame' ? config.images : [],
          createdAt: Date.now(),
        }

        setVideoTasks((prev) => {
          const next = [...prev, newTask]
          persistTasks(next)
          return next
        })

        activeTaskIdRef.current = taskId

        // Regenerate batch ID for the next video task
        batchIdRef.current = generateUUID()

        // Start polling after a short delay
        pollTimerRef.current = setTimeout(() => {
          pollTask(taskId)
        }, VIDEO_POLL_INTERVAL_MS)
      } catch (error: unknown) {
        setIsGenerating(false)
        // Extract the actual error message from the backend response.
        // Axios errors have response.data.message; fall back to the
        // generic Error.message for network errors.
        const axiosErr = error as {
          response?: { data?: { message?: string } }
        }
        const message =
          axiosErr?.response?.data?.message ||
          (error instanceof Error ? error.message : String(error))
        toast.error(t('Failed to submit video task'), {
          description: message,
        })
      }
    },
    [config, t, pollTask, persistTasks]
  )

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setIsGenerating(false)
    // Mark the active task as cancelled so it doesn't resume polling on refresh
    const taskId = activeTaskIdRef.current
    activeTaskIdRef.current = null
    if (taskId) {
      updateTask(taskId, (t) => ({
        ...t,
        status: 'cancelled',
        progress: 100,
        completedAt: Date.now(),
      }))
    }
  }, [updateTask])

  const clearTasks = useCallback(() => {
    stopPolling()
    setVideoTasks([])
    saveVideoTasks([])
  }, [stopPolling])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
      }
    }
  }, [])

  /**
   * Upload a media file to the Volcengine Files API.
   * Returns a MediaItem with local preview URL, remote URL, and duration.
   * Throws if duration exceeds limits (video ≤15s total, audio ≤15s total).
   */
  const uploadMediaItem = useCallback(
    async (
      file: File,
      type: 'image' | 'video' | 'audio',
      existingItems: MediaItem[]
    ): Promise<MediaItem> => {
      const localUrl = URL.createObjectURL(file)

      let duration: number | undefined
      if (type === 'video' || type === 'audio') {
        duration = await getMediaDuration(localUrl, type)

        // Check total duration limit
        const maxDuration =
          type === 'video' ? VIDEO_MAX_DURATION : AUDIO_MAX_DURATION
        const existingDuration = existingItems
          .filter((item) => item.type === type)
          .reduce((sum, item) => sum + (item.duration || 0), 0)
        if (existingDuration + duration > maxDuration) {
          URL.revokeObjectURL(localUrl)
          throw new Error(
            t('Total duration exceeds {{max}}s limit', { max: maxDuration })
          )
        }
      }

      // Upload to backend proxy
      setUploadProgress((prev) => ({ ...prev, [localUrl]: 0 }))
      const { url: remoteUrl } = await uploadFile(
        file,
        config.model,
        config.group,
        batchIdRef.current,
        (progress) => {
          setUploadProgress((prev) => ({ ...prev, [localUrl]: progress }))
        }
      )
      setUploadProgress((prev) => {
        const next = { ...prev }
        delete next[localUrl]
        return next
      })

      return {
        url: localUrl,
        remoteUrl,
        duration,
        type,
        name: file.name,
      }
    },
    [config.model, config.group, t]
  )

  return {
    videoTasks,
    isGenerating,
    submitVideo,
    stopPolling,
    clearTasks,
    uploadMediaItem,
    uploadProgress,
  }
}
