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
import { DETAIL_CONTENT_ELEMENTS, DETAIL_PAGE_COUNTS } from '../constants'
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
export function buildDetailPageRequest(
  config: DetailPageConfig,
  pageIndex: number
): TryOnRequest {
  if (
    !DETAIL_PAGE_COUNTS.some((count) => count === config.pageCount) ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= config.pageCount
  ) {
    throw new Error('Generation failed, please retry')
  }
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
  const hasClosing =
    config.pageCount > 1 && config.elements.includes('brand-ending')
  const contentModules = DETAIL_CONTENT_ELEMENTS.filter(
    (element) =>
      element.value !== 'brand-ending' &&
      config.elements.includes(element.value)
  ).map((element) => element.label)
  const contentPages = config.pageCount - 1 - Number(hasClosing)
  let duty = 'Cover with the product hero and headline.'
  if (pageIndex === 0 && contentPages <= 0) {
    duty += ` Summarize the selected content modules on this page: ${contentModules.join(', ') || 'product highlights'}.`
  } else if (hasClosing && pageIndex === config.pageCount - 1) {
    duty =
      'Brand closing with the product identity and a clear closing message.'
  } else if (pageIndex > 0) {
    const start = Math.floor(
      ((pageIndex - 1) * contentModules.length) / contentPages
    )
    const end = Math.max(
      start + 1,
      Math.floor((pageIndex * contentModules.length) / contentPages)
    )
    duty = `Content page focused on: ${contentModules.slice(start, end).join(', ') || 'product highlights'}. Explore a distinct product aspect for this page, without repeating the cover.`
  }
  sentences.push(
    `Generate only page ${pageIndex + 1} of ${config.pageCount}. Current page duty: ${duty}`,
    'Return exactly one standalone page image, not a contact sheet or a collage of multiple pages. The content modules describe the whole set; only render the assigned page duty in this request.'
  )
  sentences.push(
    'Conversion-focused e-commerce detail pages, clean layout, legible overlay text, studio lighting.'
  )
  if (config.ratio !== 'smart') {
    sentences.push(`Compose every page in a ${config.ratio} aspect ratio.`)
  }

  return { prompt: sentences.join(' '), images }
}
