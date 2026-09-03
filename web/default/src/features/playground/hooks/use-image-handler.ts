import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { generateImages } from '../api'
import { MAX_IMAGE_TOTAL } from '../constants'
import { createImageId, getImageModelProfile } from '../lib/image-utils'
import { loadImageTasks, saveImageTasks } from '../lib/storage/image-storage'
import type {
  ImageConfig,
  ImageGenerationDataItem,
  ImageGenerationRequest,
  ImageItem,
  ImageTask,
} from '../types'

// Build the OpenAI-compatible image body. It is identical to what an external
// caller posts to /v1/images/generations, with `group` added for gateway-side
// group selection (the backend drops it before the request goes upstream).
// Text-to-image, single-image and multi-image editing share one endpoint: the
// only difference is how many references go into `image`, which Ark accepts as a
// single URL/base64 string or as an array.
function buildImagePayload(
  config: ImageConfig,
  prompt: string
): ImageGenerationRequest {
  const payload: ImageGenerationRequest = {
    model: config.model,
    prompt,
    group: config.group,
    size: config.size,
    // Ark stamps an "AI generated" mark onto the image unless watermark is
    // explicitly false, so it is always sent: the playground offers no toggle.
    watermark: false,
  }
  // Seedream 4.x has no output_format parameter at all and answers it with a
  // 400; an empty format list in the profile means "omit the field".
  if (getImageModelProfile(config.model).outputFormats.length > 0) {
    payload.output_format = config.outputFormat
  }

  const references = config.referenceImages
    .map((item) => item.src)
    .filter(Boolean)
  if (references.length === 1) {
    payload.image = references[0]
  } else if (references.length > 1) {
    payload.image = references
  }

  // Several output images need both spellings: OpenAI-compatible providers read
  // `n`, while Seedream silently ignores it and only produces a set through
  // sequential generation. Seedream 5.0 Pro rejects that field outright, so its
  // profile clamps the count to 1 and this branch never runs for it. A single
  // image sends neither field, which keeps the body byte-for-byte the one Ark
  // documents.
  if (config.count > 1) {
    payload.n = config.count
    payload.sequential_image_generation = 'auto'
    payload.sequential_image_generation_options = { max_images: config.count }
  }

  return payload
}

// Providers return either a public URL or inline base64; normalize both into a
// renderable src so the gallery never branches on the transport.
function normalizeGeneratedImages(
  data: ImageGenerationDataItem[] | undefined,
  outputFormat: string
): ImageItem[] {
  return (data ?? [])
    .map((item) =>
      item.b64_json
        ? `data:image/${outputFormat};base64,${item.b64_json}`
        : (item.url ?? '')
    )
    .filter(Boolean)
    .map((src) => ({ id: createImageId('gen'), src }))
}

// Extract the upstream message from an axios failure. The relay answers with
// `{ error: { message } }`, while gateway middleware answers with `{ message }`.
function imageErrorMessage(error: unknown): string {
  const axiosErr = error as {
    response?: { data?: { error?: { message?: string }; message?: string } }
  }
  return (
    axiosErr?.response?.data?.error?.message ||
    axiosErr?.response?.data?.message ||
    (error instanceof Error ? error.message : String(error))
  )
}

export function useImageHandler(config: ImageConfig) {
  const { t } = useTranslation()
  const [imageTasks, setImageTasks] = useState<ImageTask[]>(() =>
    loadImageTasks()
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const persistTasks = useCallback((tasks: ImageTask[]) => {
    saveImageTasks(tasks)
  }, [])

  const updateTask = useCallback(
    (taskId: string, updater: (task: ImageTask) => ImageTask) => {
      setImageTasks((prev) => {
        const next = prev.map((task) =>
          task.id === taskId ? updater(task) : task
        )
        persistTasks(next)
        return next
      })
    },
    [persistTasks]
  )

  const generate = useCallback(
    async (prompt: string) => {
      if (!config.model) {
        toast.error(t('Please select a model first'))
        return
      }
      if (!prompt.trim()) {
        toast.error(t('Please enter a prompt'))
        return
      }
      // Ark counts references and generated images against one budget and fails
      // the whole request when it is exceeded, so refuse before spending quota.
      if (config.referenceImages.length + config.count > MAX_IMAGE_TOTAL) {
        toast.error(
          t('Reference images and generated images together exceed {{max}}', {
            max: MAX_IMAGE_TOTAL,
          })
        )
        return
      }

      const payload = buildImagePayload(config, prompt)
      const taskId = createImageId('img')
      const newTask: ImageTask = {
        id: taskId,
        status: 'pending',
        model: config.model,
        prompt,
        size: config.size,
        images: [],
        referenceImages: config.referenceImages.map((item) => ({ ...item })),
        createdAt: Date.now(),
      }

      setImageTasks((prev) => {
        const next = [...prev, newTask]
        persistTasks(next)
        return next
      })

      const controller = new AbortController()
      abortRef.current = controller
      setIsGenerating(true)

      try {
        const resp = await generateImages(payload, controller.signal)
        // The mime type must follow what was actually requested: when
        // output_format is omitted the provider falls back to its own default.
        const images = normalizeGeneratedImages(
          resp?.data,
          payload.output_format ?? 'jpeg'
        )

        if (images.length === 0) {
          updateTask(taskId, (task) => ({
            ...task,
            status: 'failed',
            error: t('No image returned'),
            completedAt: Date.now(),
          }))
          toast.error(t('Generation failed'), {
            description: t('No image returned'),
          })
          return
        }

        updateTask(taskId, (task) => ({
          ...task,
          status: 'completed',
          images,
          completedAt: Date.now(),
        }))
      } catch (error: unknown) {
        const aborted =
          error instanceof DOMException
            ? error.name === 'AbortError'
            : (error as { code?: string })?.code === 'ERR_CANCELED'

        updateTask(taskId, (task) => ({
          ...task,
          status: aborted ? 'cancelled' : 'failed',
          error: aborted ? undefined : imageErrorMessage(error),
          completedAt: Date.now(),
        }))

        if (!aborted) {
          toast.error(t('Generation failed'), {
            description: imageErrorMessage(error),
          })
        }
      } finally {
        abortRef.current = null
        setIsGenerating(false)
      }
    },
    [config, persistTasks, t, updateTask]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearTasks = useCallback(() => {
    stop()
    setImageTasks([])
    saveImageTasks([])
  }, [stop])

  // Abort an in-flight request when leaving image mode, otherwise the response
  // would land on an unmounted task list.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  return {
    imageTasks,
    isGenerating,
    generate,
    stop,
    clearTasks,
  }
}
