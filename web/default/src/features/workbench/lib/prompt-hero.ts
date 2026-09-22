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
import { HERO_CONTENT_ELEMENTS } from '../constants'
import type { HeroImageConfig } from '../types'
import type { TryOnRequest } from './prompt'

const ROLE_SENTENCE = {
  product: 'product shot — keep the product identity, shape and finish exact',
  template:
    'hero template — borrow layout, composition, background and text zones only',
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
  if (config.template) push(config.template.src, 'template')

  const sentences = [
    'Professional e-commerce hero image studio render.',
    'Base product features and copy on the provided product shots; do not copy product identity or claims from the template.',
  ]
  if (roles.length > 0) {
    sentences.push(`Role map: ${roles.join('; ')}.`)
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
  sentences.push(
    'High-click-rate e-commerce main visual, clean composition, legible overlay text zones, studio lighting.'
  )
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
  }
  const extra = config.extra.trim()
  if (extra) {
    sentences.push(
      'Follow the additional requirements below. For requested on-image text, preserve the exact wording, numbers, currency symbols and punctuation; do not invent different slogans or prices. Explicit additional requirements take priority over inferred copy and conflicting content-element selections.',
      `Additional requirements:\n${extra}`
    )
  }

  return { prompt: sentences.join(' '), images }
}
