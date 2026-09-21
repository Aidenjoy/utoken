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
import type { DuoRelation, DuoTryOnConfig } from '../types'
import type { TryOnRequest } from './prompt'

const RELATION_SENTENCE: Record<DuoRelation, string> = {
  couple: 'The two models are a couple wearing coordinated matching looks.',
  brothers: 'The two models are brothers wearing coordinated looks.',
  besties: 'The two models are close friends wearing coordinated looks.',
  'parent-child':
    'The two models are a parent and a child wearing coordinated looks.',
}

/**
 * Fuse the duo roles into one OpenAI-compatible image body. Image order must
 * stay in sync with the prompt role map: garment pieces or colorways, pair
 * composition reference, model 1, model 2, scene background, pose references.
 */
export function buildDuoTryOnRequest(config: DuoTryOnConfig): TryOnRequest {
  const images: string[] = []
  const roles: string[] = []
  const pushRole = (src: string, description: string) => {
    images.push(src)
    roles.push(`image ${images.length}: ${description}`)
  }

  // Exactly two shots in diff-color mode read as one colorway per model;
  // otherwise every shot is a piece of the single outfit both models wear.
  const colorways =
    config.colorMode === 'diff-color' && config.garments.length === 2
  config.garments.forEach((garment, index) => {
    pushRole(
      garment.src,
      colorways
        ? `garment colorway ${index + 1} of one design — keep cut and pattern exactly, apply this colorway`
        : `garment piece ${index + 1} to wear — keep fabric, cut, pattern and color exactly`
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
      'model 1 — preserve face, identity and body proportions exactly'
    )
  }
  if (config.childModel) {
    pushRole(
      config.childModel.src,
      'model 2 — preserve face, identity and body proportions exactly'
    )
  }
  if (config.scene) {
    pushRole(
      config.scene.src,
      'scene background — compose the output against this environment (stage, indoor, etc.)'
    )
  }
  config.actions.forEach((action) => {
    pushRole(action.src, 'pose reference — borrow pose and action only')
  })

  const sentences = [
    'Professional e-commerce virtual try-on photography of two models in one scene.',
    `Role map: ${roles.join('; ')}.`,
    RELATION_SENTENCE[config.relation],
    colorways
      ? 'The garment shots are colorways of one design: dress model 1 in colorway 1 and model 2 in colorway 2, keeping cut and pattern identical.'
      : 'Combine all provided garment pieces into one complete coordinated outfit and dress both models in it.',
  ]
  if (!colorways && config.colorMode === 'diff-color') {
    sentences.push(
      'The two models wear different colorways of the combined outfit.'
    )
  }
  if (!config.adultModel && !config.childModel) {
    sentences.push(
      'Cast suitable commercial models matching the relation when no model photo is provided.'
    )
  }
  sentences.push(
    'Preserve the garment and every model identity unchanged; photorealistic skin texture, studio-grade lighting, clean catalog framing.',
    'Pose, camera angle and background may be fully recreated for a fresh commercial look.'
  )
  if (config.scene) {
    sentences.push('Compose the shot against the provided scene background.')
  }
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
  }

  return { prompt: sentences.join(' '), images }
}
