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
  DUO_GARMENT_STYLES,
  TRY_ON_EXPRESSIONS,
  TRY_ON_ORIENTATIONS,
  TRY_ON_POSES,
} from '../constants'
import type { ChipOption, DuoRelation, DuoTryOnConfig } from '../types'
import type { TryOnRequest } from './prompt'

const RELATION_SENTENCE: Record<DuoRelation, string> = {
  couple: 'The two models are a couple wearing coordinated matching looks.',
  brothers: 'The two models are brothers wearing coordinated looks.',
  besties: 'The two models are close friends wearing coordinated looks.',
  'parent-child':
    'The two models are a parent and a child wearing coordinated looks.',
}

function labelOf(options: ChipOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}

/**
 * Fuse the duo roles into one OpenAI-compatible image body. Image order must
 * stay in sync with the prompt role map: garment colorways, pair composition
 * reference, adult model, child model, pose references.
 */
export function buildDuoTryOnRequest(config: DuoTryOnConfig): TryOnRequest {
  const images: string[] = []
  const roles: string[] = []
  const pushRole = (src: string, description: string) => {
    images.push(src)
    roles.push(`image ${images.length}: ${description}`)
  }

  config.garments.forEach((garment, index) => {
    pushRole(
      garment.src,
      `garment colorway ${index + 1} to wear on both models — keep fabric, cut, pattern and color exactly`
    )
  })
  if (config.reference) {
    pushRole(
      config.reference.src,
      'pair composition reference — borrow the two people placement, pose relation, framing and background only'
    )
  }
  if (config.adultModel) {
    pushRole(
      config.adultModel.src,
      'adult model — preserve face, identity and body proportions exactly'
    )
  }
  if (config.childModel) {
    pushRole(
      config.childModel.src,
      'child model — preserve face, identity and body proportions exactly'
    )
  }
  config.actions.forEach((action) => {
    pushRole(action.src, 'pose reference — borrow pose and action only')
  })

  const garmentLabel = config.garmentName.trim() || 'the provided garment'
  const sentences = [
    'Professional e-commerce virtual try-on photography of two models in one scene.',
    `Role map: ${roles.join('; ')}.`,
    RELATION_SENTENCE[config.relation],
    config.colorMode === 'same-color'
      ? `Both models wear the identical garment in the same colorway: ${garmentLabel}.`
      : `Both models wear the same design in different colorways, one per garment shot: ${garmentLabel}.`,
    `Garment style: ${labelOf(DUO_GARMENT_STYLES, config.garmentStyle)}.`,
  ]
  if (!config.adultModel && !config.childModel) {
    sentences.push(
      'Cast suitable commercial models matching the relation when no model photo is provided.'
    )
  }
  sentences.push(
    'Preserve the garment and every model identity unchanged; photorealistic skin texture, studio-grade lighting, clean catalog framing.'
  )
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
      `Both models face ${labelOf(TRY_ON_ORIENTATIONS, config.orientation)}.`
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
  if (config.naturalVariation) {
    sentences.push(
      'Pose and expression must differ naturally from every reference; never copy a reference frame verbatim.'
    )
  }
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
  }

  return { prompt: sentences.join(' '), images }
}
