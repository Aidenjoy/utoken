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
import type { CloseUpConfig, GarmentBaseConfig } from '../types'
import type { TryOnRequest } from './prompt'

const VIEW_ROLE: Record<string, string> = {
  front: 'garment shot from the front — keep the garment identity exact',
  side: 'garment shot from the side — keep the garment identity exact',
  back: 'garment shot from the back — keep the garment identity exact',
}

/** 底图按模式独立生成；位置模式使用服装视角、细节参考和可选模特。 */
export function buildCloseUpRequest(config: CloseUpConfig): TryOnRequest {
  if (config.shotMode === 'flat') return buildFlatLayRequest(config.flat)
  if (config.shotMode === 'threed') return buildThreeDRequest(config.threed)

  const sources: { src: string; role: string }[] = []
  for (const view of ['front', 'side', 'back'] as const) {
    const image = config[view]
    if (image) sources.push({ src: image.src, role: VIEW_ROLE[view] })
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
  sentences.push(
    'Render close-up detail shots of the garment at the picked positions.'
  )
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

/** 先生成完整服装平铺底图，供后续局部细节生成使用。 */
export function buildFlatLayRequest(config: GarmentBaseConfig): TryOnRequest {
  if (!config.front?.src) {
    throw new Error('Upload the required front garment image')
  }
  if (config.generationMode === 'reference' && !config.reference?.src) {
    throw new Error('Upload a flat-lay layout reference')
  }

  const images = [config.front.src]
  const roles = [
    'image 1: primary front garment image — the authoritative source for garment identity, silhouette, color, print, logos and construction',
  ]
  if (config.supplement?.src) {
    images.push(config.supplement.src)
    roles.push(
      `image ${images.length}: optional supplementary shot of the same garment — clarify visible fabric and construction only; never replace the primary front image`
    )
  }
  if (config.generationMode === 'reference' && config.reference?.src) {
    images.push(config.reference.src)
    roles.push(
      `image ${images.length}: flat-lay layout reference only — borrow arrangement, spacing, folds and lighting, not its garment, colors, print, logos or text`
    )
  }

  const sentences = [
    'Professional e-commerce full-garment flat-lay base image, suitable as the source for later detail close-ups.',
    `Role map: ${roles.join('; ')}.`,
    'Show the complete front garment laid flat, photographed from directly above. Keep the entire silhouette, sleeves, neckline and hem inside the frame with clear margins. Do not replace the full garment with cropped detail-only images.',
    'Preserve the exact garment identity from image 1. Do not invent unseen back views or alter the product design. Remove the wearer, mannequin, hanger and original background. No people, hands, bodies or 3D ghost-mannequin styling.',
    'Use a clean pure white background and soft studio lighting by default. Do not add promotional text, prices or watermarks; retain existing garment logos and prints.',
    config.generationMode === 'reference'
      ? 'Follow the layout reference while keeping the primary front garment complete and recognizable.'
      : 'Choose a balanced flat-lay arrangement automatically. The complete front view is the main subject; optional small detail views must come only from visible source details.',
  ]
  if (config.garmentType.trim()) {
    sentences.push(`Uploaded garment type: ${config.garmentType.trim()}.`)
  }
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the base image in a ${config.ratio} aspect ratio.`)
  }
  if (config.note.trim()) {
    sentences.push(
      'The following merchant requirements override default styling and background, but must preserve garment identity and the complete front silhouette.',
      `Additional requirements:\n${config.note.trim()}`
    )
  }
  return { prompt: sentences.join('\n'), images }
}

/** 生成完整服装立体底图，参考图仅控制 3D／2.5D 表现和构图。 */
export function buildThreeDRequest(config: GarmentBaseConfig): TryOnRequest {
  if (!config.front?.src) {
    throw new Error('Upload the required front garment image')
  }
  if (config.generationMode === 'reference' && !config.reference?.src) {
    throw new Error('Upload a 3D style reference')
  }

  const images = [config.front.src]
  const roles = [
    'image 1: primary front garment image — the authoritative source for garment identity, silhouette, color, print, logos and construction',
  ]
  if (config.supplement?.src) {
    images.push(config.supplement.src)
    roles.push(
      `image ${images.length}: optional supplementary shot of the same garment — clarify visible fabric, construction and supported additional views only; never replace the primary front image`
    )
  }
  if (config.generationMode === 'reference' && config.reference?.src) {
    images.push(config.reference.src)
    roles.push(
      `image ${images.length}: 3D style reference only — borrow dimensional styling, view arrangement, framing and lighting, not its garment, colors, print, logos, people or text`
    )
  }

  const sentences = [
    'Professional e-commerce full-garment 3D white-background base image, suitable as the source for later detail close-ups.',
    `Role map: ${roles.join('; ')}.`,
    'Render the complete garment with realistic three-dimensional volume, natural drape, hollow openings and crisp fabric texture, as if worn on an invisible mannequin. Keep the entire silhouette, sleeves, neckline and hem inside the frame with clear margins. Do not create a flat-lay or cropped detail-only image.',
    'Preserve the exact garment identity from image 1. Remove the original background, wearer, visible mannequin and hanger. No people, hands, bodies or mannequin parts. Additional views must stay consistent with the supplied garment; do not invent unseen logos, prints, pockets or decorative construction.',
    'Use a clean pure white background, soft studio lighting and subtle natural shadows by default. Do not add promotional text, prices or watermarks; retain existing garment logos and prints.',
    config.generationMode === 'reference'
      ? 'Follow the reference for 3D or 2.5D dimensional presentation and view arrangement while preserving the complete primary garment and its identity. Do not transfer reference garments or human models.'
      : 'Automatically create a balanced 3D ghost-mannequin presentation. Make the complete front view prominent; complementary angled views of the same garment may appear together in this single base image when consistent with the source material.',
  ]
  if (config.garmentType.trim()) {
    sentences.push(`Uploaded garment type: ${config.garmentType.trim()}.`)
  }
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the base image in a ${config.ratio} aspect ratio.`)
  }
  if (config.note.trim()) {
    sentences.push(
      'The following merchant requirements override default styling and background, but must preserve garment identity, dimensional form and the complete silhouette.',
      `Additional requirements:\n${config.note.trim()}`
    )
  }
  return { prompt: sentences.join('\n'), images }
}
