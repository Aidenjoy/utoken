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
 * in sync with it: model, garments, details, actions, references, scene.
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
  config.references.forEach((reference) => {
    pushRole(
      reference.src,
      'composition reference — borrow composition, camera angle and lighting only'
    )
  })
  if (config.scene) {
    pushRole(
      config.scene.src,
      'scene background — compose the output against this environment (stage, indoor, etc.)'
    )
  }

  const sentences = [
    'Professional e-commerce virtual try-on photography.',
    `Role map: ${roles.join('; ')}.`,
    config.model
      ? 'Dress the model in the provided garment.'
      : 'Cast a suitable commercial model and dress them in the provided garment.',
    'Preserve the garment fit and the model identity unchanged; photorealistic skin texture, studio-grade lighting, clean catalog framing.',
  ]

  if (config.intimateApparel) {
    sentences.push(
      'The garment is intimate apparel (underwear, swimwear or lingerie): keep the styling tasteful and catalog-appropriate.'
    )
  }
  if (config.scene) {
    sentences.push('Compose the shot against the provided scene background.')
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
