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
import { DETAIL_CONTENT_ELEMENTS } from '../constants'
import type { DetailPageConfig } from '../types'
import type { TryOnRequest } from './prompt'

const LANGUAGE_LABEL: Record<string, string> = {
  zh: 'Simplified Chinese',
  en: 'English',
  ja: 'Japanese',
}

/**
 * Fuse the product sample group with the confirmed selling facts and the
 * checked content modules into one OpenAI-compatible image body; the prompt
 * carries the index→role map plus the ordered page plan for the set.
 */
export function buildDetailPageRequest(config: DetailPageConfig): TryOnRequest {
  const images = config.products.map((item) => item.src)

  const sentences = ['Professional e-commerce detail page set render.']
  if (images.length > 0) {
    const roles = images.map(
      (_src, index) =>
        `image ${index + 1}: product shot — keep the product identity, shape and finish exact`
    )
    sentences.push(`Role map: ${roles.join('; ')}.`)
  }
  if (config.name.trim()) {
    sentences.push(`Product name: ${config.name.trim()}.`)
  }
  if (config.selling.trim()) {
    sentences.push(
      `Core selling points and requirements: ${config.selling.trim()}.`
    )
  }
  if (config.audience.trim()) {
    sentences.push(`Target audience: ${config.audience.trim()}.`)
  }
  if (config.scene.trim()) {
    sentences.push(`Use scenes: ${config.scene.trim()}.`)
  }
  sentences.push(
    'All uploaded shots belong to one product sample group; keep the product identity consistent on every page.'
  )
  const modules = DETAIL_CONTENT_ELEMENTS.filter((element) =>
    config.elements.includes(element.value)
  ).map((element) => element.label)
  sentences.push(`Content modules: ${modules.join(', ') || 'none'}.`)
  sentences.push(
    `Overlay text language: ${LANGUAGE_LABEL[config.textLanguage] ?? 'Simplified Chinese'}.`
  )
  sentences.push(
    config.sceneMode === 'unified'
      ? 'Use one unified scene across all pages.'
      : 'Assign the best-matching scene to each page.'
  )
  const closing = config.elements.includes('brand-ending')
    ? ' the last page is the brand closing;'
    : ''
  sentences.push(
    `Page plan (${config.pageCount} pages): page 1 is the cover with the product hero and headline; then one page per content module in order;${closing} split or repeat modules when pages outnumber modules.`
  )
  sentences.push(
    'Conversion-focused e-commerce detail pages, clean layout, legible overlay text, studio lighting.'
  )
  if (config.ratio !== 'smart') {
    sentences.push(`Compose every page in a ${config.ratio} aspect ratio.`)
  }

  return { prompt: sentences.join(' '), images }
}
