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
import { t } from 'i18next'
import { z } from 'zod'

import type { TryOnGenerationBody } from '../api'
import { TRY_ON_RATIOS } from '../constants'
import type {
  DesignItem,
  DesignOutput,
  DesignPlan,
  DesignRequest,
} from '../design-types'
import { DESIGN_CHANNELS } from '../packaging-config'
import type { ChipOption, TryOnImage } from '../types'
import { buildImageSize } from './image-size'

const imageSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  src: z.string().trim().min(1),
})
const textSchema = z.string().max(2000)
const itemSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(80),
  notes: z.string().max(500),
  image: imageSchema.nullable(),
  quantity: z.number().int().min(1).max(4),
})

export function validateImage(
  image: TryOnImage | null,
  required = false
): void {
  if (image === null && !required) return
  if (!imageSchema.safeParse(image).success) {
    throw new Error(t('Upload the required reference image'))
  }
}

export function validateText(text: string, required = false, max = 2000): void {
  if (
    !textSchema.max(max).safeParse(text).success ||
    (required && !text.trim())
  ) {
    throw new Error(t('Complete the required text within the character limit'))
  }
}

export function validateChoice(
  value: string,
  options: readonly ChipOption[]
): ChipOption {
  const selected = options.find((option) => option.value === value)
  if (!selected) throw new Error(t('Select a valid design option'))
  return selected
}

export function validateOutput(
  config: DesignOutput,
  fixedCount: boolean,
  multiRatio = false
): void {
  if (
    !['2K', '4K'].includes(config.resolution) ||
    (!multiRatio &&
      !TRY_ON_RATIOS.some((option) => option.value === config.ratio))
  ) {
    throw new Error(t('Select a valid resolution and aspect ratio'))
  }
  if (
    !fixedCount &&
    (!Number.isInteger(config.count) || config.count < 1 || config.count > 4)
  ) {
    throw new Error(t('Choose between 1 and 4 images'))
  }
}

export function validateChannels(channels: string[]): void {
  if (
    !Array.isArray(channels) ||
    channels.length < 1 ||
    channels.length > 3 ||
    new Set(channels).size !== channels.length
  ) {
    throw new Error(t('Select at least one output format'))
  }
  channels.forEach((ratio) => validateChoice(ratio, DESIGN_CHANNELS))
}

export function validateItems(
  items: DesignItem[],
  min: number,
  max: number,
  requireImage: boolean,
  requireName: boolean,
  quantities = false
): void {
  if (!Array.isArray(items) || items.length < min || items.length > max) {
    throw new Error(t('Use between {{min}} and {{max}} items', { min, max }))
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error(t('Each item needs a unique identity'))
  }
  for (const item of items) {
    // 非数量流程不读取隐藏的数量值。
    if (
      !itemSchema.safeParse({
        ...item,
        quantity: quantities ? item.quantity : 1,
      }).success
    ) {
      throw new Error(t('Check item names, notes, images and quantities (1–4)'))
    }
    validateImage(item.image, requireImage)
    validateText(item.name, requireName, 80)
  }
}

export function designPlanToBodies(
  plan: DesignPlan,
  resolution: string,
  model: string
): TryOnGenerationBody[] {
  if (!model.trim()) throw new Error(t('Select an image model'))
  if (plan.requests.length < 1 || plan.requests.length > 6) {
    throw new Error(t('A design run supports 1–6 images'))
  }
  return plan.requests.map((request) => {
    validateOutput({ resolution, ratio: request.ratio, count: 1 }, false)
    if (
      !request.prompt.trim() ||
      request.images.some((image) => !image.trim())
    ) {
      throw new Error(t('Select a valid design option'))
    }
    return {
      model,
      prompt: request.prompt,
      size: buildImageSize(resolution, request.ratio),
      n: 1,
      watermark: false,
      ...(request.images.length ? { image: [...request.images] } : {}),
    }
  })
}

/** 从实际请求反推归档源图，不收集未启用的上传槽或历史成片。 */
export function finishDesignPlan(
  requests: DesignRequest[],
  continuity?: DesignPlan['continuity']
): DesignPlan {
  if (requests.length < 1 || requests.length > 6) {
    throw new Error(t('A design run supports 1–6 images'))
  }
  return {
    requests,
    continuity,
    sources: [...new Set(requests.flatMap((request) => request.images))],
  }
}
