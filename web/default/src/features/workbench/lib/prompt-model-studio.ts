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
import type { ModelStudioConfig } from '../types'
import type { TryOnRequest } from './prompt'

/** Role suffix of each multi-view slot in the existing-model flow. */
const MODEL_STUDIO_VIEW_ROLES = [
  'front view reference',
  'left side view reference',
  'right side view reference',
]

/**
 * Fuse the portrait slots (or the multi-view uploads / the single existing
 * portrait) with the optional haircut / hair color references into one
 * OpenAI-compatible image body; the prompt carries the index→role map plus
 * the identity-preservation rules.
 */
export function buildModelStudioRequest(
  config: ModelStudioConfig
): TryOnRequest {
  const sources: { src: string; role: string }[] = []
  if (config.mode === 'compose') {
    config.faces.forEach((face, index) => {
      if (face) {
        sources.push({
          src: face.src,
          role: `face reference ${index + 1} — all references show one person whose identity must be preserved`,
        })
      }
    })
  } else if (config.mode === 'existing') {
    config.views.forEach((view, index) => {
      if (view) {
        sources.push({
          src: view.src,
          role: `${MODEL_STUDIO_VIEW_ROLES[index]} — all views show one person whose identity must be preserved`,
        })
      }
    })
  } else if (config.model) {
    sources.push({
      src: config.model.src,
      role: 'model reference — keep the person identity exact',
    })
  }
  if (config.hairStyle) {
    sources.push({
      src: config.hairStyle.src,
      role: 'hairstyle reference — apply this haircut shape',
    })
  }
  if (config.hairColor) {
    sources.push({
      src: config.hairColor.src,
      role: 'hair color reference — apply this hair color',
    })
  }

  let sentences: string[]
  if (config.mode === 'compose') {
    sentences = ['Professional e-commerce virtual model identity render.']
  } else if (config.mode === 'existing') {
    sentences = ['Professional e-commerce full-body model synthesis.']
  } else {
    sentences = ['Professional e-commerce model restyle render.']
  }
  if (sources.length > 0) {
    const roles = sources.map(
      (_item, index) => `image ${index + 1}: ${sources[index].role}`
    )
    sentences.push(`Role map: ${roles.join('; ')}.`)
  }
  if (config.mode === 'compose') {
    sentences.push(
      'Synthesize one consistent virtual model identity from the face references.'
    )
  } else if (config.mode === 'existing') {
    sentences.push(
      'Synthesize one full-body model image of the same person from the multi-view references, preserving identity, hairstyle and makeup.'
    )
  } else {
    sentences.push(
      'Keep the person identity exact while applying only the requested hair changes.'
    )
  }
  if (config.hairStyle && config.hairColor) {
    sentences.push('Apply the provided hairstyle and hair color.')
  } else if (config.hairStyle) {
    sentences.push('Apply the provided hairstyle.')
  } else if (config.hairColor) {
    sentences.push('Apply the provided hair color.')
  } else {
    sentences.push(
      'Infer a natural commercial hairstyle and hair color when unspecified.'
    )
  }
  if (config.mode === 'existing') {
    sentences.push(
      'Full-body studio shot, soft even lighting, clean background.'
    )
  } else {
    sentences.push(
      'Chest-up studio portrait with shoulders fully visible, soft even lighting, clean background.'
    )
  }
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
  }

  return {
    prompt: sentences.join(' '),
    images: sources.map((item) => item.src),
  }
}
