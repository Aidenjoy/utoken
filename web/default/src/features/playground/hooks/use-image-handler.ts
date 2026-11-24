import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { buildImageSize } from '@/lib/image-size'

import { generateImages } from '../api'
import { MAX_IMAGE_TOTAL } from '../constants'
import {
  abortActiveGeneration,
  appendImageTask,
  clearImageTasks,
  getImageTasks,
  setActiveGenerationController,
  subscribeImageTasks,
  updateImageTask,
} from '../lib/image-task-store'
import { createImageId, getImageModelProfile } from '../lib/image-utils'
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
  const profile = getImageModelProfile(config.model)
  // Ark tiers carry no aspect ratio of their own: pair the tier with the picked
  // ratio into an explicit WxH (the bare tier would let the model choose).
  // 'auto' keeps the bare tier, and WxH-only providers send their size as-is.
  const size =
    profile.supportsRatio && config.ratio !== 'auto'
      ? buildImageSize(config.size, config.ratio)
      : config.size
  const payload: ImageGenerationRequest = {
    model: config.model,
    prompt,
    group: config.group,
    size,
    // Ask for SSE: the gateway commits headers immediately and keepalives the
    // connection while the upstream renders, so a slow generation no longer
    // dies on the reverse proxy's read timeout (504). The gateway strips the
    // field before the upstream call (Seedream 5.0 Pro rejects it outright).
    stream: true,
    // Ark stamps an "AI generated" mark onto the image unless watermark is
    // explicitly false, so it is always sent: the playground offers no toggle.
    watermark: false,
  }
  // 超管显式锁定渠道；Auto（0）不带字段，与普通用户一致。
  if (config.channelId > 0) {
    payload.channel_id = config.channelId
  }
  // Seedream 4.x has no output_format parameter at all and answers it with a
  // 400; an empty format list in the profile means "omit the field".
  if (profile.outputFormats.length > 0) {
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
// A proxy-generated 504 carries an HTML body instead: surface a readable
// gateway-timeout hint rather than the raw axios status line.
function imageErrorMessage(
  error: unknown,
  t: (key: string) => string
): string {
  const axiosErr = error as {
    response?: {
      status?: number
      data?: { error?: { message?: string }; message?: string }
    }
  }
  if (axiosErr?.response?.status === 504) {
    return t('Gateway timeout (504). Please try again.')
  }
  return (
    axiosErr?.response?.data?.error?.message ||
    axiosErr?.response?.data?.message ||
    (error instanceof Error ? error.message : String(error))
  )
}

export function useImageHandler(config: ImageConfig) {
  const { t } = useTranslation()
  // 任务住在模块级 store：菜单切换卸载组件不会中断请求，重新挂载后继续
  // 接收同一次生成的进度与结果。
  const imageTasks = useSyncExternalStore(subscribeImageTasks, getImageTasks)
  const isGenerating = imageTasks.some((task) => task.status === 'pending')

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
        size: payload.size ?? config.size,
        images: [],
        referenceImages: config.referenceImages.map((item) => ({ ...item })),
        createdAt: Date.now(),
      }

      appendImageTask(newTask)

      const controller = new AbortController()
      setActiveGenerationController(controller)

      try {
        const resp = await generateImages(payload, controller.signal)
        // The mime type must follow what was actually requested: when
        // output_format is omitted the provider falls back to its own default.
        const images = normalizeGeneratedImages(
          resp?.data,
          payload.output_format ?? 'jpeg'
        )

        if (images.length === 0) {
          updateImageTask(taskId, (task) => ({
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

        updateImageTask(taskId, (task) => ({
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

        updateImageTask(taskId, (task) => ({
          ...task,
          status: aborted ? 'cancelled' : 'failed',
          error: aborted ? undefined : imageErrorMessage(error, t),
          completedAt: Date.now(),
        }))

        if (!aborted) {
          toast.error(t('Generation failed'), {
            description: imageErrorMessage(error, t),
          })
        }
      } finally {
        setActiveGenerationController(null)
      }
    },
    [config, t]
  )

  const stop = useCallback(() => {
    abortActiveGeneration()
  }, [])

  const clearTasks = useCallback(() => {
    stop()
    clearImageTasks()
  }, [stop])

  // 刻意不在卸载时 abort：切换菜单再切回来必须能拿到仍在渲染的结果，
  // 中断只会让后端照常计费而页面丢图（日志响应快照也为空）。

  return {
    imageTasks,
    isGenerating,
    generate,
    stop,
    clearTasks,
  }
}
