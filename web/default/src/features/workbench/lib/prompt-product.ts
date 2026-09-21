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
import { DESIGN_BOARD_TYPES, DESIGN_PRESETS } from '../constants'
import type { ProductDesignConfig } from '../types'
import type { TryOnRequest } from './prompt'

/**
 * Fuse the source product photo and the selected template into one
 * OpenAI-compatible image body. The single image is always the product;
 * the direction and board layout travel inside the prompt.
 */
export function buildProductDesignRequest(
  config: ProductDesignConfig
): TryOnRequest {
  const images = config.product ? [config.product.src] : []
  const sentences = ['Image 1 is the source product photo.']

  const presets = DESIGN_PRESETS[config.direction] ?? []
  const preset = presets.find((item) => item.value === config.preset)
  if (config.direction === 'custom') {
    sentences.push(`Design direction: ${config.customBrief.trim()}.`)
  } else if (preset) {
    sentences.push(`Design direction: ${preset.focus}.`)
    const boardType = DESIGN_BOARD_TYPES[preset.boardType]
    if (boardType) {
      sentences.push(`Present the result as ${boardType.board}.`)
    }
  }
  sentences.push(
    'Keep the core identity of the product in image 1 recognizable in every cell.'
  )
  sentences.push(
    'Studio-quality rendering, clean e-commerce board layout, legible labels.'
  )
  if (config.notes.trim()) {
    sentences.push(`Additional requirements: ${config.notes.trim()}.`)
  }
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
  }

  return { prompt: sentences.join(' '), images }
}
