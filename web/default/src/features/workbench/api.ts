/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { isAxiosError } from 'axios'
import { t } from 'i18next'

import { api } from '@/lib/api'

import {
  TRY_ON_GENERATIONS_ENDPOINT,
  WORKBENCH_MAX_GENERATION_COUNT,
} from './constants'

export interface TryOnGenerationBody {
  model: string
  prompt: string
  size: string
  n: number
  watermark: boolean
  /** Flat reference list; the prompt carries the index→role map. */
  image: string | string[]
}

export interface TryOnGenerationResultItem {
  url?: string
  b64_json?: string
}

export interface TryOnGenerationResponse {
  created?: number
  data?: TryOnGenerationResultItem[]
  error?: { message?: string }
}

/**
 * Session-authenticated image generation, same OpenAI-compatible body an
 * external caller sends to /v1/images/generations. Failures come back as
 * `{ error: { message } }`, so the caller surfaces the message itself.
 */
export async function generateTryOnImages(
  body: TryOnGenerationBody,
  signal?: AbortSignal
): Promise<TryOnGenerationResponse> {
  const res = await api.post(TRY_ON_GENERATIONS_ENDPOINT, body, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data as TryOnGenerationResponse
}

/** 逐张请求并立即交付结果；失败即停止，不重试，避免额外计费。 */
export async function generateImageBatch(
  requests: TryOnGenerationBody[],
  onImage: (url: string, request: TryOnGenerationBody) => void,
  signal?: AbortSignal,
  setMode?: 'model' | 'product' | 'detail'
): Promise<void> {
  // 发起任何计费请求前校验完整计划，保留工作台原有单项张数上限。
  if (
    requests.length === 0 ||
    requests.some(
      (request) =>
        !Number.isInteger(request.n) ||
        request.n < 1 ||
        request.n > WORKBENCH_MAX_GENERATION_COUNT
    )
  ) {
    throw new Error(t('Generation failed, please retry'))
  }

  // 首张成片作为本次套图固定的视觉锚点，不逐张替换，以免累积偏差。
  let setReference: string | undefined
  for (const request of requests) {
    for (let index = 0; index < request.n; index++) {
      const body = { ...request, n: 1 }
      if (setMode && setReference) {
        const images = Array.isArray(request.image)
          ? [...request.image]
          : [request.image]
        images.push(setReference)
        body.image = images
        let referenceRole = `Image ${images.length} is the first finished photograph of this same set, supplied as the fixed visual continuity reference, not a new subject or a layout template. Keep the original source images authoritative for identity and factual details; never propagate mistakes from the generated reference.`
        let continuity =
          'Continue the same product photo shoot: match product identity, true colors, materials and photographic treatment. Reuse the established background, surfaces, props and lighting for scene-enabled images, honoring any uploaded shared scene. The current required purpose, scene/copy policy and prohibitions always take priority: white-background images must stay uniform #FFFFFF without scene or text, scene-disabled images must not inherit scenery, and detail images must remain close-ups. Do not copy the reference headline, claims, framing or image purpose. If the reference has no usage environment, follow the shared scene instructions instead.'
        if (setMode === 'model') {
          continuity =
            'Continue the exact same photo shoot: match this finished reference in person identity, the specific outfit and accessories, physical background, fixed props, lighting, colors, photographic style and framing scale. Do not choose another outfit or scene. Change only the requested pose, expression and body view; do not duplicate its pose or override the current view. Preserve the uploaded shared scene and explicit whole-set requirements.'
        } else if (setMode === 'detail') {
          referenceRole = `Image ${images.length} is the first finished detail-page segment, supplied as the fixed visual continuity reference. Original product sources remain authoritative for identity and verified facts; never propagate mistakes from this generated reference.`
          continuity =
            'Continue this same editorial detail-page sequence: match the established palette, light direction, background materials, typography hierarchy and horizontal margins. Environmental backgrounds are allowed for every module. If the first segment is a tight close-up, extend its palette, material and light into a suitable environment rather than enlarging it into a fake scene. Preserve shared visual requirements, use current-module references for composition, and prioritize the current module over copying the first segment. Do not duplicate its headline, labels, claims, people, framing or content; adapt the layout to the current task. Use compatible edge tones for vertical assembly without an outer card frame.'
        }
        body.prompt = [
          request.prompt,
          referenceRole,
          continuity,
          setMode === 'detail'
            ? 'Return only the current finished segment, not a multi-page contact sheet or a copy of the continuity reference. Relevant detail insets within this segment are allowed.'
            : 'Return only the single requested image, not a collage or a copy of the continuity reference.',
        ].join('\n')
      }
      let response: TryOnGenerationResponse
      try {
        response = await generateTryOnImages(body, signal)
      } catch (error) {
        if (
          isAxiosError<TryOnGenerationResponse & { message?: string }>(error)
        ) {
          const message =
            error.response?.data?.error?.message ||
            error.response?.data?.message
          if (typeof message === 'string' && message.trim()) {
            throw new Error(message)
          }
        }
        throw error
      }
      if (response.error?.message) throw new Error(response.error.message)
      const urls = (response.data ?? [])
        .map(
          (item) =>
            item.url ||
            (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '')
        )
        .filter(Boolean)
      if (urls.length === 0) {
        throw new Error(t('The model returned no images'))
      }
      if (urls.length !== 1) {
        throw new Error(
          t('The model must return exactly one image per request')
        )
      }
      if (setMode && !setReference) setReference = urls[0]
      onImage(urls[0], request)
    }
  }
}
