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
  HERO_CONTENT_ELEMENTS,
  TRY_ON_EXPRESSIONS,
  TRY_ON_ORIENTATIONS,
  TRY_ON_POSES,
} from '../constants'
import type { ChipOption, HeroImageConfig } from '../types'
import type { TryOnRequest } from './prompt'

const ROLE_SENTENCE = {
  product: 'product shot — keep the product identity, shape and finish exact',
  template:
    'hero template — borrow layout, composition, background and text zones only',
  model: 'model — use this person identity exactly',
  action: 'action reference — borrow pose and framing only',
}

function choiceLabel(options: ChipOption[], value: string): string | null {
  if (value === 'auto') return null
  return options.find((option) => option.value === value)?.label ?? null
}

/**
 * Fuse product shots, template references and the hero content checklist
 * into one OpenAI-compatible image body; the prompt carries the index→role
 * map plus the include/omit overlay list.
 */
export function buildHeroImageRequest(config: HeroImageConfig): TryOnRequest {
  const images: string[] = []
  const roles: string[] = []
  const push = (src: string, role: keyof typeof ROLE_SENTENCE) => {
    images.push(src)
    roles.push(`image ${images.length}: ${ROLE_SENTENCE[role]}`)
  }
  for (const item of config.products) push(item.src, 'product')
  for (const item of config.templates) push(item.src, 'template')
  if (config.personMode === 'replace' && config.model) {
    push(config.model.src, 'model')
  }
  for (const item of config.actions) push(item.src, 'action')

  const sentences = ['Professional e-commerce hero image studio render.']
  if (roles.length > 0) {
    sentences.push(`Role map: ${roles.join('; ')}.`)
  }
  if (config.description.trim()) {
    sentences.push(`Product description: ${config.description.trim()}.`)
  }
  if (config.extra.trim()) {
    sentences.push(`Extra requirements: ${config.extra.trim()}.`)
  }
  const included = HERO_CONTENT_ELEMENTS.filter((element) =>
    config.elements.includes(element.value)
  ).map((element) => element.label)
  const omitted = HERO_CONTENT_ELEMENTS.filter(
    (element) => !config.elements.includes(element.value)
  ).map((element) => element.label)
  sentences.push(
    `Include on the hero image: ${included.join(', ') || 'nothing'}.`
  )
  if (omitted.length > 0) {
    sentences.push(`Omit: ${omitted.join(', ')}.`)
  }
  if (config.personMode === 'keep') {
    sentences.push(
      'If the product shots contain a person, keep that person unchanged.'
    )
  } else if (config.model) {
    sentences.push(
      'Replace any person in the product shots with the provided model.'
    )
  } else {
    sentences.push(
      'Replace any person in the product shots with an AI-generated model.'
    )
  }
  sentences.push(
    config.outputMode === 'optimize'
      ? 'Keep the original action from the product shots; optimize only lighting and background.'
      : 'Create a completely new composition, action and background.'
  )
  const pose = choiceLabel(TRY_ON_POSES, config.pose)
  if (pose) sentences.push(`Model pose: ${pose}.`)
  const orientation = choiceLabel(TRY_ON_ORIENTATIONS, config.orientation)
  if (orientation) sentences.push(`Model facing: ${orientation}.`)
  const expression = choiceLabel(TRY_ON_EXPRESSIONS, config.expression)
  if (expression) sentences.push(`Model expression: ${expression}.`)
  if (config.actionNote.trim()) {
    sentences.push(`Model action: ${config.actionNote.trim()}.`)
  }
  if (config.actions.length > 0) {
    sentences.push(
      'Borrow pose and framing from the action reference images, matched randomly across outputs.'
    )
  }
  sentences.push(
    'High-click-rate e-commerce main visual, clean composition, legible overlay text zones, studio lighting.'
  )
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
  }

  return { prompt: sentences.join(' '), images }
}
