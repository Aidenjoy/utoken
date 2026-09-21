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

/**
 * Fuse the portrait slots (or the single existing portrait) with the optional
 * haircut / hair color references into one OpenAI-compatible image body; the
 * prompt carries the index→role map plus the identity-preservation rules.
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

  const sentences =
    config.mode === 'compose'
      ? ['Professional e-commerce virtual model identity render.']
      : ['Professional e-commerce model restyle render.']
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
  sentences.push(
    'Chest-up studio portrait with shoulders fully visible, soft even lighting, clean background.'
  )

  return {
    prompt: sentences.join(' '),
    images: sources.map((item) => item.src),
  }
}
