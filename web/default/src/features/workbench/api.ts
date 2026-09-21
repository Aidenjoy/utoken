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
import { api } from '@/lib/api'

import { TRY_ON_GENERATIONS_ENDPOINT } from './constants'

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
