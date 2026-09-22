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
import { fashionInputsFor } from '../constants'
import type {
  FashionDesignConfig,
  FashionInputKey,
  FashionPreset,
} from '../types'
import type { TryOnRequest } from './prompt'

const ROLE_SENTENCE: Record<FashionInputKey, string> = {
  garment:
    'the base garment — keep its silhouette and construction as the design base',
  fabric:
    'fabric/pattern swatch — apply its material, pattern and color exactly',
  reference: 'style reference — borrow its design language only',
  lineart: 'line art sketch — follow its silhouette and seam lines exactly',
}

function ratioSentence(config: FashionDesignConfig): string | null {
  return config.ratio !== 'smart'
    ? `Compose the frame in a ${config.ratio} aspect ratio.`
    : null
}

function collectImages(
  config: FashionDesignConfig,
  inputs: ReturnType<typeof fashionInputsFor>
): { images: string[]; roles: string[] } {
  const images: string[] = []
  const roles: string[] = []
  for (const input of inputs) {
    for (const image of config.images[input.key]) {
      images.push(image.src)
      roles.push(`image ${images.length}: ${ROLE_SENTENCE[input.key]}`)
    }
  }
  return { images, roles }
}

/**
 * Fuse the uploaded materials and the selected fashion template into one
 * OpenAI-compatible image body; the prompt carries the index→role map.
 */
export function buildFashionRequest(
  config: FashionDesignConfig,
  preset: FashionPreset | null
): TryOnRequest {
  const inputs = fashionInputsFor(config.direction, config.preset)
  const { images, roles } = collectImages(config, inputs)

  const sentences = ['Professional fashion design studio render.']
  if (roles.length > 0) {
    sentences.push(`Role map: ${roles.join('; ')}.`)
  }
  if (config.direction === 'free') {
    sentences.push(`Task: ${config.description.trim()}.`)
  } else if (preset) {
    sentences.push(`Task: ${preset.focus}.`)
  }
  if (preset?.usesColor) {
    sentences.push(`Target color: ${config.color}.`)
  }
  if (config.description.trim() && config.direction !== 'free') {
    sentences.push(`Instruction: ${config.description.trim()}.`)
  }
  sentences.push(
    'Photorealistic fabric rendering, clean studio lighting, e-commerce catalog quality.'
  )
  const ratio = ratioSentence(config)
  if (ratio) sentences.push(ratio)

  return { prompt: sentences.join(' '), images }
}
