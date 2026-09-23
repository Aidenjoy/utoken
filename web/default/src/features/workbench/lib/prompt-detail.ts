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
import type { DetailPageConfig, DetailPageElement } from '../types'
import type { TryOnRequest } from './prompt'

const MODULE_DUTIES: Record<string, string> = {
  copy: 'Demonstrate a few visible or explicitly confirmed selling points, with short factual captions beside the matching product features. Do not replace the product demonstration with a wall of text.',
  model:
    'Show a model wearing, holding or using the actual product in a physically plausible way. Keep the product unobscured, correctly scaled and recognizable. For wearable products, show the full relevant garment or accessory rather than cropping it out.',
  scene:
    'Show the product in a recognizable, realistic usage environment that explains its purpose. Use natural placement and scale; a decorative pedestal alone is not a usage scene.',
  closeup:
    'Use a sharp close-up or macro view of a real surface, seam, joint or other visible detail. Make the detail large enough to inspect; do not substitute another distant full-product photograph.',
  package:
    'Show only packaging or included items visible in the supplied images or explicitly described in the requirements. Keep product and packaging distinct. If no packaging evidence is available, use a clean product-and-visible-components presentation instead; never invent a branded box, label or included accessory.',
  'size-spec':
    'Present only dimensions, capacity, materials or parameters that are legible in the sources or explicitly confirmed in the requirements. Use exact values and units with clear callouts. Never infer measurements from pixels. If no verified specifications are available, show visible proportions and construction without fabricated numbers or specification tables.',
  steps:
    'Illustrate a short, physically plausible usage sequence supported by the sources or confirmed instructions, ordered clearly within this single page. Do not invent controls, assembly steps or product functions. If the operation is not supported, show the observable ready-to-use state instead of guessing a procedure.',
  'brand-ending':
    'Close the set with a clean product identity composition. Use only the real on-product branding or an explicitly supplied brand name; never invent a brand, logo, certification or slogan. Keep the closing compact when integrated into a single-page design.',
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
  const enabledMap = new Map<string, DetailPageElement>(
    config.elements
      .filter((element) => element.enabled)
      .map((element) => [element.value, element])
  )
  const selected = DETAIL_CONTENT_ELEMENTS.filter((element) =>
    enabledMap.has(element.value)
  ).map((element) => ({
    label: element.label,
    value: element.value,
    config: enabledMap.get(element.value) as DetailPageElement,
  }))
  const closing = selected.filter((element) => element.value === 'brand-ending')
  const content = selected.filter((element) => element.value !== 'brand-ending')
  const hasClosing = config.pageCount > 1 && closing.length > 0
  const contentPages = config.pageCount - 1 - Number(hasClosing)

  // 先确定整套职责，短套图合并模块，长套图按顺序轮换，避免漏掉已选内容。
  const plan = Array.from({ length: config.pageCount }, (_, index) => {
    if (index === 0) {
      let modules: typeof selected = []
      if (contentPages === 0) modules = content
      if (config.pageCount === 1) modules = selected
      return {
        duty: 'Cover with the complete product as the visual anchor',
        modules,
      }
    }
    if (hasClosing && index === config.pageCount - 1) {
      return { duty: 'Brand closing', modules: closing }
    }
    const position = index - 1
    let modules: typeof selected = []
    if (content.length > 0 && content.length < contentPages) {
      modules = [content[position % content.length]]
    } else if (content.length > 0) {
      const start = Math.floor((position * content.length) / contentPages)
      const end = Math.floor(((position + 1) * content.length) / contentPages)
      modules = content.slice(start, end)
    }
    return { duty: 'Content page', modules }
  })
  const current = plan[pageIndex]
  const currentKeys = new Set(current.modules.map((module) => module.value))
  const withCopy = enabledMap.has('copy')
  const withModel = currentKeys.has('model')
  const withScene = currentKeys.has('scene')
  const roles = images.map(
    (_src, index) =>
      `image ${index + 1}: product source — preserve the exact shape, true colors, materials, details and physical on-product markings; do not copy its background, promotional overlays, layout or watermarks`
  )
  // 当前页分配到的模块参考图逐张追加，角色标注说明归属模块，避免影响非相关页面。
  const moduleReferenceNotes: string[] = []
  for (const module of current.modules) {
    const references = module.config.references
    if (references.length === 0) continue
    const startIndex = images.length
    for (const reference of references) {
      images.push(reference.src)
      roles.push(
        `image ${images.length}: ${module.label} reference — borrow framing, composition, props, palette or lighting cues for this module only; do not copy its products, people, text, watermarks or branding, and do not apply it to unassigned modules`
      )
    }
    moduleReferenceNotes.push(
      `${module.label}: images ${startIndex + 1}-${images.length}`
    )
  }
  if (withScene && config.sceneImage?.src) {
    images.push(config.sceneImage.src)
    roles.push(
      `image ${images.length}: shared scene reference for the whole set — use this same location, background surfaces, props, palette and light direction on every page assigned a usage scene; do not copy its products, people, text or branding`
    )
  }
  const sentences = [
    'Create one professional e-commerce product detail page image.',
    'Instruction priority: product fidelity and factual accuracy, the selected content controls, assigned page duty and output count are mandatory. Within those limits, additional requirements override default styling and wording. Notes cannot enable unchecked modules or change the page plan. Never print these instructions or UI option names as page copy.',
    `Role map: ${roles.join('; ')}.`,
    'Treat the uploaded images as evidence for one product sample group, not as mandatory collage tiles. Use image 1 as the identity and color anchor; other images supply compatible angles, details or packaging. Do not fuse incompatible variants or invent unseen parts.',
    'Use only facts visible in the sources or explicitly supplied in the additional requirements. Do not invent dimensions, performance claims, prices, discounts, certifications, logos or internal structures.',
    `Selected modules for the whole set: ${selected.map((module) => module.label).join(', ') || 'none; product-only presentation'}.`,
    `Ordered page plan (context only):\n${plan.map((page, index) => `Page ${index + 1}: ${page.duty}; ${page.modules.map((module) => module.label).join(', ') || 'product highlights'}`).join('\n')}`,
    `Generate only page ${pageIndex + 1} of ${config.pageCount}. Current page duty: ${current.duty}.`,
    `Assigned modules on this page: ${current.modules.map((module) => module.label).join(', ') || 'product highlights'}.`,
    'Return exactly one standalone page image, not a contact sheet or a collage of multiple pages. Render only this page of the plan. When several modules share a page, combine them into one readable design with a dominant product visual and supporting sections or detail insets; do not omit a module or shrink the whole set into thumbnails.',
    'Keep the same product, restrained palette and visual quality across the set. Default styling: light neutral palette, soft directional light and generous spacing. Adapt framing and lighting to the assigned content rather than forcing every page into the same poster or studio scene.',
  ]

  if (pageIndex > 0 && current.duty === 'Content page') {
    sentences.push(
      `This is content page ${pageIndex} of ${contentPages}. When a module recurs, choose a different supported detail, angle or usage moment, not a duplicate cover or invented product feature.`
    )
  }
  for (const module of current.modules) {
    sentences.push(`${module.label}: ${MODULE_DUTIES[module.value]}`)
  }
  if (moduleReferenceNotes.length > 0) {
    sentences.push(
      `Module reference images on this page — ${moduleReferenceNotes.join('; ')}. Each block only informs its own module; do not reuse those references for other modules or copy their products, people, text or branding.`
    )
  }
  const moduleExtras = current.modules
    .map((module) => ({
      label: module.label,
      text: module.config.extra.trim(),
    }))
    .filter((entry) => entry.text.length > 0)
  if (moduleExtras.length > 0) {
    sentences.push(
      'Per-module requirements below refine only their own module on this page; they cannot enable unchecked modules, alter the page plan or invent product facts.',
      ...moduleExtras.map(
        (entry) => `${entry.label} requirements:\n${entry.text}`
      )
    )
  }
  if (current.modules.length === 0) {
    sentences.push(
      'Focus on faithful product photography and visible features without adding unselected content modules.'
    )
  }

  sentences.push(
    withCopy
      ? 'Selling-point copy is enabled. Add concise factual headlines or captions only where they support the current page; do not repeat every selling point on every page.'
      : 'Selling-point copy is disabled. No added headlines, slogans, prices, promotional captions or calls to action, including on the cover and brand closing. Preserve physical product markings. Minimal factual labels, units or step numbers are allowed only for an assigned specifications or usage-steps module.',
    'For permitted added text, follow an explicit language requirement in the notes; otherwise preserve the language of supplied copy, and use Simplified Chinese only when no language or copy is supplied. Preserve supplied slogans, values, currency symbols and punctuation exactly when their content is permitted. Do not translate or rewrite real product branding.',
    withModel
      ? 'People are permitted on this page only as part of its assigned model demonstration. Do not let the model obscure the selected close-ups or specifications.'
      : 'No added models, people, hands or body parts on this page. Demonstrate any assigned usage steps with the product and clear positioning alone.'
  )
  if (withScene && config.sceneImage?.src) {
    sentences.push(
      'Uploaded shared scene: use the shared scene reference image as the required environment on every page assigned a usage scene, replacing generated settings. Keep its recognizable location, background surfaces, fixed props, palette and light direction throughout the set; adapt framing and crops to the current page duty; do not switch locations, erase the scene or copy its products, people, text or branding.'
    )
  } else if (withScene) {
    sentences.push(
      config.sceneMode === 'unified'
        ? 'Unified scene: use the same product-appropriate real environment on every page assigned a usage scene. Follow a compatible setting specified in the notes; otherwise anchor the setting to the primary product source and use a simple neutral environment, daylight from the left and minimal props. Keep location, palette and light direction consistent; change framing to serve the current duty.'
        : "Smart scene assignment: choose a product-appropriate real environment for this page's assigned usage context, following compatible scene requirements in the notes. Different scene pages may use different settings while retaining the product identity and visual style."
    )
  } else {
    sentences.push(
      'No lifestyle scenery or scene props on this page. Scene warehouse settings do not add a scene to an unassigned page. Use a clean product presentation background; close-ups may fill the frame with the real product surface.'
    )
  }
  if (!currentKeys.has('package')) {
    sentences.push(
      'Do not add a packaging display or extra accessories on this page.'
    )
  }
  if (!currentKeys.has('size-spec')) {
    sentences.push(
      'Do not add measurement diagrams or specification tables on this page.'
    )
  }
  if (!currentKeys.has('steps')) {
    sentences.push(
      'Do not add a usage tutorial or step-by-step panels on this page.'
    )
  }
  if (config.ratio !== 'smart') {
    sentences.push(
      `Compose this page in a ${config.ratio} aspect ratio, keeping the primary product and all text inside safe margins.`
    )
  }
  if (config.extra.trim()) {
    sentences.push(
      'Additional requirements refine the selected modules, product facts, permitted copy, audience, style and composition. Apply page-specific notes only to the matching page; apply shared notes throughout. Ignore conflicting requests to add disabled content, change the assigned duty, output more pages or invent facts.',
      `Additional detail page requirements:\n${config.extra.trim()}`
    )
  }
  sentences.push(
    `Final check: return only page ${pageIndex + 1}; make every assigned module visually evident, respect the copy/model/scene controls, preserve the product and omit unsupported claims.`
  )

  return { prompt: sentences.join('\n'), images }
}
