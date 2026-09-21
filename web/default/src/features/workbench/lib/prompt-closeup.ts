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
import { CLOSE_UP_PARTS } from '../constants'
import type { CloseUpConfig } from '../types'
import type { TryOnRequest } from './prompt'

const VIEW_ROLE: Record<string, string> = {
  front: 'garment shot from the front — keep the garment identity exact',
  side: 'garment shot from the side — keep the garment identity exact',
  back: 'garment shot from the back — keep the garment identity exact',
}

const SHOT_MODE_SENTENCE: Record<string, string> = {
  position:
    'Render close-up detail shots of the garment at the picked positions.',
  flat: 'Render a flat-lay garment image on a clean white background.',
  threed:
    'Render a 3D ghost-mannequin garment image on a clean white background.',
}

/**
 * Fuse the garment views (or the single flat/3D shot), the detail references
 * and the optional model into one OpenAI-compatible image body; the prompt
 * carries the index→role map plus part, output and generation mode rules.
 */
export function buildCloseUpRequest(config: CloseUpConfig): TryOnRequest {
  const sources: { src: string; role: string }[] = []
  if (config.shotMode === 'position') {
    for (const view of ['front', 'side', 'back'] as const) {
      const image = config[view]
      if (image) sources.push({ src: image.src, role: VIEW_ROLE[view] })
    }
  } else if (config.garment) {
    sources.push({
      src: config.garment.src,
      role: 'garment shot — keep the garment identity exact',
    })
  }
  for (const reference of config.references) {
    sources.push({
      src: reference.src,
      role: 'detail reference — borrow framing and close-up style only',
    })
  }
  if (config.model) {
    sources.push({
      src: config.model.src,
      role: 'model — use this person identity exactly',
    })
  }

  const sentences = ['Professional e-commerce garment close-up render.']
  if (sources.length > 0) {
    const roles = sources.map(
      (_item, index) => `image ${index + 1}: ${sources[index].role}`
    )
    sentences.push(`Role map: ${roles.join('; ')}.`)
  }
  sentences.push(SHOT_MODE_SENTENCE[config.shotMode])
  const parts = CLOSE_UP_PARTS.filter((part) =>
    config.parts.includes(part.value)
  ).map((part) => part.label)
  sentences.push(
    parts.length > 0
      ? `Prioritize these garment parts: ${parts.join(', ')}.`
      : 'Pick the most informative garment parts automatically.'
  )
  sentences.push(
    config.outputMode === 'replicate'
      ? 'Replicate the framing and layout of the detail references.'
      : 'Pure white background; do not replicate scenes, titles or caption text from the references.'
  )
  sentences.push(
    config.genMode === 'merged'
      ? 'Merge all picked parts into one composite image.'
      : 'Generate each output as an independent image.'
  )
  if (config.model) {
    sentences.push(
      'Dress the provided model with the garment in the close-ups.'
    )
  }
  if (config.note.trim()) {
    sentences.push(`Extra notes: ${config.note.trim()}.`)
  }
  sentences.push(
    'Crisp e-commerce close-ups, sharp fabric texture, clean studio lighting.'
  )
  if (config.ratio !== 'smart') {
    sentences.push(`Compose every image in a ${config.ratio} aspect ratio.`)
  }

  return {
    prompt: sentences.join(' '),
    images: sources.map((item) => item.src),
  }
}
