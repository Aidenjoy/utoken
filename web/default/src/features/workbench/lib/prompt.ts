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
import type { TryOnConfig } from '../types'

export interface TryOnRequest {
  prompt: string
  /** Reference images in role order; index i maps to "image i+1" in the prompt. */
  images: string[]
}

/**
 * Fuse the uploaded roles into one OpenAI-compatible image body. The upstream
 * model receives a flat reference list, so the prompt carries an explicit role
 * map ("image 1 = model, images 2-3 = garment...") and the order here must stay
 * in sync with it: model, garments, details, actions, scene references.
 */
export function buildTryOnRequest(config: TryOnConfig): TryOnRequest {
  const images: string[] = []
  const roles: string[] = []

  const pushRole = (src: string, description: string) => {
    images.push(src)
    roles.push(`image ${images.length}: ${description}`)
  }

  if (config.model) {
    pushRole(
      config.model.src,
      'the model — preserve face, identity and body proportions exactly'
    )
  }
  config.garments.forEach((garment, index) => {
    pushRole(
      garment.src,
      `garment shot ${index + 1} to wear — keep fabric, cut, pattern and color exactly`
    )
  })
  config.details.forEach((detail) => {
    pushRole(
      detail.src,
      'garment detail close-up — use it only to raise fabric and accessory fidelity'
    )
  })
  config.actions.forEach((action) => {
    pushRole(action.src, 'pose reference — borrow pose and action only')
  })
  if (config.atmosphereSource === 'reference') {
    config.references.forEach((reference) => {
      pushRole(
        reference.src,
        'scene reference — borrow composition, camera angle and lighting only'
      )
    })
  }

  const garmentLabel = config.garmentName.trim() || 'the provided garment'
  const sentences = [
    'Professional e-commerce virtual try-on photography.',
    `Role map: ${roles.join('; ')}.`,
    config.model
      ? `Dress the model in ${garmentLabel}.`
      : `Cast a suitable commercial model and dress them in ${garmentLabel}.`,
    'Preserve the garment fit and the model identity unchanged; photorealistic skin texture, studio-grade lighting, clean catalog framing.',
  ]

  if (config.intimateApparel) {
    sentences.push(
      'The garment is intimate apparel (underwear, swimwear or lingerie): keep the styling tasteful and catalog-appropriate.'
    )
  }
  if (config.atmosphereSource === 'action' && config.actions.length > 0) {
    sentences.push(
      'Borrow the atmosphere from the pose references: action and body language only, never their backgrounds.'
    )
  }
  if (config.atmosphereSource === 'reference' && config.references.length > 0) {
    sentences.push(
      'Borrow the atmosphere from the scene references: composition, camera height and lighting mood.'
    )
  }
  if (config.naturalVariation) {
    sentences.push(
      'Pose and expression must differ naturally from every reference; never copy a reference frame verbatim.'
    )
  }

  return { prompt: sentences.join(' '), images }
}
