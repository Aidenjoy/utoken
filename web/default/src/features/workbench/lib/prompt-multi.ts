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
import {
  MULTI_AGE_GROUPS,
  MULTI_GENDERS,
  MULTI_STRUCTURES,
  TRY_ON_EXPRESSIONS,
  TRY_ON_ORIENTATIONS,
  TRY_ON_POSES,
} from '../constants'
import type { ChipOption, MultiGarmentSlot, MultiTryOnConfig } from '../types'
import type { TryOnRequest } from './prompt'

const SLOT_ROLE: Record<MultiGarmentSlot, string> = {
  top: 'top garment piece to wear — keep fabric, cut, pattern and color exactly',
  bottom:
    'bottom garment piece to wear — keep fabric, cut, pattern and color exactly',
  inner:
    'inner layer garment piece to wear — keep fabric, cut, pattern and color exactly',
  outer:
    'outer layer garment piece to wear — keep fabric, cut, pattern and color exactly',
}

const STRUCTURE_SENTENCE: Record<MultiTryOnConfig['structure'], string> = {
  'top-bottom':
    'Combine the top and bottom pieces into one complete outfit and dress the model in it.',
  'inner-outer':
    'Layer the inner and outer pieces into one complete outfit and dress the model in it.',
  'three-piece':
    'Layer the inner, outer and bottom pieces into one complete coordinated outfit and dress the model in it.',
}

function labelOf(options: ChipOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}

/**
 * Fuse the structured multi-garment roles into one OpenAI-compatible image
 * body. Image order must stay in sync with the prompt role map: garment slots
 * in structure order, model, pose references, scene references.
 */
export function buildMultiTryOnRequest(config: MultiTryOnConfig): TryOnRequest {
  const structure =
    MULTI_STRUCTURES.find((item) => item.value === config.structure) ??
    MULTI_STRUCTURES[0]
  const images: string[] = []
  const roles: string[] = []
  const pushRole = (src: string, description: string) => {
    images.push(src)
    roles.push(`image ${images.length}: ${description}`)
  }

  for (const slot of structure.slots) {
    const image = config.slots[slot]
    if (image) pushRole(image.src, SLOT_ROLE[slot])
  }
  if (config.model) {
    pushRole(
      config.model.src,
      'the model — preserve face, identity and body proportions exactly'
    )
  }
  config.actions.forEach((action) => {
    pushRole(action.src, 'pose reference — borrow pose and action only')
  })
  config.references.forEach((reference) => {
    pushRole(
      reference.src,
      'scene reference — borrow composition, camera angle and lighting only'
    )
  })

  const garmentLabel = config.garmentName.trim() || 'the provided outfit'
  const sentences = [
    'Professional e-commerce virtual try-on photography of a multi-piece outfit.',
    `Role map: ${roles.join('; ')}.`,
    STRUCTURE_SENTENCE[config.structure],
    config.model
      ? `Dress the model in ${garmentLabel}.`
      : `Cast a suitable commercial model and dress them in ${garmentLabel}.`,
    `Garment category: ${labelOf(MULTI_GENDERS, config.gender)}, ${labelOf(
      MULTI_AGE_GROUPS,
      config.ageGroup
    )}.`,
    'Preserve every garment piece and the model identity unchanged; photorealistic skin texture, studio-grade lighting, clean catalog framing.',
  ]
  if (config.description.trim()) {
    sentences.push(`Garment notes: ${config.description.trim()}.`)
  }
  if (config.outputMode === 'keep-original') {
    sentences.push(
      'Keep the original action and background of the reference framing, only refine them.'
    )
  } else {
    sentences.push(
      'Pose, camera angle and background may be fully recreated for a fresh commercial look.'
    )
  }
  if (config.pose !== 'auto') {
    sentences.push(`Body pose: ${labelOf(TRY_ON_POSES, config.pose)}.`)
  }
  if (config.orientation !== 'auto') {
    sentences.push(
      `The model faces ${labelOf(TRY_ON_ORIENTATIONS, config.orientation)}.`
    )
  }
  if (config.expression !== 'auto') {
    sentences.push(
      `Facial expression: ${labelOf(TRY_ON_EXPRESSIONS, config.expression)}.`
    )
  }
  if (config.actionNote.trim()) {
    sentences.push(`Action requirement: ${config.actionNote.trim()}.`)
  }
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
  }

  return { prompt: sentences.join(' '), images }
}
