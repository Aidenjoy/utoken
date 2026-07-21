import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { fetchVideoTask, submitVideoTask } from '../api'
import { VIDEO_POLL_INTERVAL_MS } from '../constants'
import {
  loadVideoTasks,
  saveVideoTasks,
} from '../lib/storage/video-storage'
import type {
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

function buildSubmitPayload(
  config: VideoConfig,
  prompt: string
): VideoSubmitRequest {
  const payload: VideoSubmitRequest = {
    model: config.model,
    prompt,
    group: config.group,
    duration: config.duration,
    seconds: String(config.duration),
  }

  if (config.images.length > 0) {
    payload.images = config.images
  }

  const metadata: Record<string, unknown> = {
    resolution: config.resolution,
    generate_audio: config.audio,
    n: config.count,
    mode: config.mode,
  }
  if (config.ratio !== 'smart') {
    metadata.ratio = config.ratio
  }
  payload.metadata = metadata

  return payload
}

export function useVideoHandler(config: VideoConfig) {
  const { t } = useTranslation()
  const [videoTasks, setVideoTasks] = useState<VideoTask[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTaskIdRef = useRef<string | null>(null)

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
          updateTask(taskId, (t) => ({
            ...t,
            status: 'failed',
            progress: 100,
            error: resp.error?.message ?? t.error ?? 'Unknown error',
            completedAt: Date.now(),
          }))
          setIsGenerating(false)
          activeTaskIdRef.current = null
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
      if (!prompt.trim()) {
        toast.error(t('Please enter a prompt'))
        return
      }

      const payload = buildSubmitPayload(config, prompt)

      // Log the submit payload for debugging (truncate image data)
      const logPayload = {
        ...payload,
        images: payload.images?.map((img) =>
          img.length > 100 ? img.substring(0, 80) + '...(truncated)' : img
        ),
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
          images: config.images,
          createdAt: Date.now(),
        }

        setVideoTasks((prev) => {
          const next = [newTask, ...prev]
          persistTasks(next)
          return next
        })

        activeTaskIdRef.current = taskId

        // Start polling after a short delay
        pollTimerRef.current = setTimeout(() => {
          pollTask(taskId)
        }, VIDEO_POLL_INTERVAL_MS)
      } catch (error: unknown) {
        setIsGenerating(false)
        const message =
          error instanceof Error ? error.message : String(error)
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

  return {
    videoTasks,
    isGenerating,
    submitVideo,
    stopPolling,
    clearTasks,
  }
}
