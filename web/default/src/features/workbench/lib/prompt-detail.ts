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
import type {
  DetailPageConfig,
  DetailPageElement,
  DetailPageElementValue,
} from '../types'
import type { TryOnRequest } from './prompt'

const MODULE_DUTIES: Record<DetailPageElementValue, string> = {
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
    'Close the story with a memorable product-in-context composition and one short closing line grounded in the product. Continue the established environment and palette rather than switching to an empty logo card. Use only the real on-product branding or an explicitly supplied brand name; never invent a brand, logo, certification or promise.',
}

/** 勾选列表与出图顺序的共同来源：仅保留已知、启用的模块，每项一次。 */
export function getSelectedDetailElements(
  elements: DetailPageElement[]
): Array<DetailPageElement & { label: string }> {
  return DETAIL_CONTENT_ELEMENTS.flatMap((option) => {
    const element = elements.find((item) => item.value === option.value)
    return element?.enabled ? [{ ...element, label: option.label }] : []
  })
}

/** 每个已选模块对应一张可纵向拼接的详情页分段，不额外插入封面。 */
export function buildDetailPageRequest(
  config: DetailPageConfig,
  pageIndex: number
): TryOnRequest {
  const selected = getSelectedDetailElements(config.elements)
  if (selected.length === 0) {
    throw new Error('Select at least one content module')
  }
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= selected.length
  ) {
    throw new Error('Generation failed, please retry')
  }
  const current = selected[pageIndex]
  const images = config.products.map((item) => item.src)
  const roles = images.map(
    (_src, index) =>
      `image ${index + 1}: product source — preserve the exact shape, true colors, materials, details and physical on-product markings; do not copy promotional overlays, layout or watermarks. Its backdrop is not a requirement to use a blank background.`
  )
  for (const reference of current.references) {
    images.push(reference.src)
    roles.push(
      `image ${images.length}: ${current.label} module reference — borrow composition, framing and lighting for this segment, within the shared visual direction; do not copy its products, people, text, watermarks or branding`
    )
  }
  const sentences = [
    'Design one finished image-and-text segment of a premium e-commerce product detail page, intended to read vertically with the other segments.',
    `Generate only segment ${pageIndex + 1} of ${selected.length}. Current module: ${current.label}.`,
    `Reading order (context only): ${selected.map((module, index) => `${index + 1}. ${module.label}`).join(' → ')}.`,
    'Each selected module gets exactly one segment. Do not insert a cover, merge modules, repeat a module or render the whole sequence. The first segment must fulfill its own module, not become a generic cover.',
    'Return exactly one finished segment image, not a contact sheet or a collage of multiple pages. Detail insets or step illustrations are allowed within the current module.',
    `Role map: ${roles.join('; ')}.`,
    'Product identity and verified facts are authoritative. Treat the product sources as one sample group, not mandatory collage tiles. Image 1 anchors identity and color; other product sources supply compatible angles and details. Do not fuse incompatible variants or invent unseen parts.',
    'Use only facts visible in the product sources or explicitly supplied in the requirements. Do not invent dimensions, performance claims, prices, discounts, certifications, logos or internal structures. Decorative props must not be presented as included accessories.',
    `Module task: ${MODULE_DUTIES[current.value]}`,
    'Art direction: build an immersive product-appropriate environment with tactile surfaces, believable contact shadows, directional light and a coherent palette drawn from the product. Fill the composition with intentional photography, material detail and integrated text, not an isolated cutout floating on a large blank white canvas.',
    'Every module may use environmental backgrounds, contextual props, material textures and coordinated color fields, even when the usage-scene module is not selected. A usage-scene segment specifically explains where and how the product is used; it is not a background permission switch.',
    'Choose a setting suitable for this product, not a stock setting imposed on every category. Close-ups can fill the frame with real material; specifications can use a coordinated textured surface and readable callouts. Preserve breathing room for text without turning most of the image into empty background.',
    'Across the sequence, keep the same palette, light direction, background material language, typographic hierarchy and horizontal text margins. Vary full-product views, close-ups and information layouts to serve each module; do not repeat the same poster composition.',
    'Design edge-to-edge for vertical assembly: no screenshot frame, outer card border, rounded outer corners, oversized white margins or printed page numbers. Keep text and essential product features inside safe margins and away from the top and bottom cut edges; use compatible tones at the joins. Do not draw connectors that require exact alignment with another segment.',
    'Text is allowed on every segment, independently of the selling-point overview module. By default, write one specific headline of about 6–14 Chinese characters, optionally one short subtitle, and only a few brief labels beside relevant details. Confirmed specification values and supplied exact copy are not subject to this headline length guideline. Honor an explicit request for a text-free design.',
    'Write about the actual product and the current module, not generic superlatives. Do not print UI option names, module names, instructions, placeholder text or repeated slogans. Integrate text with the image rather than placing a long paragraph above a tiny product.',
    'Follow an explicit language requirement in the notes; otherwise preserve the language of supplied copy, and use Simplified Chinese when neither is given. Preserve supplied titles, slogans, values, units, currency symbols and punctuation exactly. Never translate or rewrite real product branding.',
    'Typography: use clean, legible Chinese letterforms, a clear headline/subtitle/label size hierarchy, consistent alignment and strong contrast against calm parts of the background. Keep all characters complete and readable; no fake glyphs, decorative pseudo-text, tiny dense copy or words over busy product details.',
    'Priority: product fidelity and facts, current module and one-image output come first. Shared requirements set the visual direction; current-module notes refine only this segment. Module references guide its composition; a supplied first finished segment guides continuity, never new facts or repeated content. Do not inherit errors from generated references.',
    current.value === 'model'
      ? 'People are permitted as part of this model demonstration. Keep the actual product recognizable, unobscured and correctly scaled.'
      : 'Do not add a model or people as the subject of this segment. For verified usage steps, a supporting hand is allowed only if needed to demonstrate the real action.',
  ]
  if (config.ratio !== 'smart') {
    sentences.push(`Compose this segment in a ${config.ratio} aspect ratio.`)
  }
  if (config.extra.trim()) {
    sentences.push(
      'Apply shared notes throughout and page-specific notes only to their matching segment. Notes cannot add modules, change the selected order or invent product facts.',
      `Additional detail page requirements:\n${config.extra.trim()}`
    )
  }
  if (current.extra.trim()) {
    sentences.push(
      `${current.label} requirements for this segment only:\n${current.extra.trim()}`
    )
  }
  sentences.push(
    `Final check: return only segment ${pageIndex + 1}, visibly fulfill ${current.label}, preserve the real product, use a designed background and readable concise copy, and omit unsupported claims.`
  )
  return { prompt: sentences.join('\n'), images }
}
