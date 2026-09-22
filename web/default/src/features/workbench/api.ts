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

import { DETAIL_PAGE_COUNTS, TRY_ON_GENERATIONS_ENDPOINT } from './constants'

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
  signal?: AbortSignal
): Promise<void> {
  // 发起任何请求前校验完整计划；详情页是工作台单项张数上限。
  if (
    requests.length === 0 ||
    requests.some(
      (request) =>
        !Number.isInteger(request.n) ||
        request.n < 1 ||
        request.n > Math.max(...DETAIL_PAGE_COUNTS)
    )
  ) {
    throw new Error(t('Generation failed, please retry'))
  }

  for (const request of requests) {
    for (let index = 0; index < request.n; index++) {
      let response: TryOnGenerationResponse
      try {
        response = await generateTryOnImages({ ...request, n: 1 }, signal)
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
      onImage(urls[0], request)
    }
  }
}
