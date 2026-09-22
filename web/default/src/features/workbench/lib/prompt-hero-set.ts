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
  HERO_SET_ANGLE_COUNTS,
  HERO_SET_ANGLES,
  HERO_SET_EXPRESSIONS,
  PRODUCT_SET_MAX,
  PRODUCT_SET_TYPES,
} from '../constants'
import type { ChipOption, HeroSetConfig } from '../types'
import type { TryOnRequest } from './prompt'

const ANGLE_SENTENCE: Record<string, string> = {
  front:
    'Front view: the torso faces the camera directly, not a side or back view.',
  side: 'Side view: show a clear lateral profile of the body, not a front view.',
  back: 'Back view: show the back of the body and outfit; do not turn the torso toward the camera to show the face.',
}

const POSE_SENTENCE: Record<string, string> = {
  standing:
    'Standing upright on both feet. Show the complete standing silhouette from the top of the head to both shoes, including legs and feet.',
  sitting:
    'Seated naturally on a suitable seat. Show the entire seated body, the seat contact, legs and feet.',
  walking:
    'Walking with a natural stride, visible leg movement and balanced arm motion. Include the entire body and both feet.',
  leaning:
    'Leaning naturally against a suitable support. Keep the complete body, support contact and feet visible.',
  lying:
    'Lying down naturally on a suitable surface. Frame the whole reclining body from head to feet.',
  handheld:
    'Hold the featured item naturally in the hands, with correct grip and unobstructed item details. Keep the model visible.',
}

const OUTFIT_SENTENCE: Record<string, string> = {
  casual:
    'a coordinated casual outfit with relaxed everyday separates and matching casual footwear',
  commuter:
    'a coordinated commuter outfit with tailored workwear and matching smart footwear',
  sporty:
    'a coordinated sporty outfit with an athletic top, sports bottoms and sneakers',
  dress:
    'an elegant dress with coordinated footwear and restrained accessories',
}

const OTHER_SENTENCE: Record<string, string> = {
  lighting:
    'Use consistent light direction, color temperature, exposure and soft shadow quality in every image.',
  atmosphere:
    'Add subtle environmental depth and atmosphere through background and lighting; keep the subject clearly readable and the environment coherent across the set.',
  details:
    'Make clothing texture, seams and accessories sharply legible within the requested framing; do not replace a full-body view with a cropped detail close-up.',
  'text-space':
    'Reserve the left 35% of the canvas as one continuous, clean, low-detail negative-space area for a large marketing headline to be added later. Place the entire subject in the right 65%, leaving clear separation from this area. No body parts, props, decorative graphics, text, letters or watermarks may occupy the reserved area. Do not render the headline itself. Keep this layout consistent across the set; scale the subject down rather than crop it.',
}

function choiceLabel(options: ChipOption[], value: string): string | null {
  if (!value) return null
  return options.find((option) => option.value === value)?.label ?? null
}

/** Total outputs of one run: the per-angle counts summed up. */
export function heroSetTotalCount(config: HeroSetConfig): number {
  if (config.mode === 'product') {
    return config.product.shots.reduce((total, shot) => total + shot.count, 0)
  }
  return config.angles.reduce((total, angle) => total + angle.count, 0)
}

/** 逐用途构建商品套图请求，参考图和补充要求不会串入其他用途。 */
export function buildProductSetRequests(
  config: HeroSetConfig
): (TryOnRequest & { count: number })[] {
  const product = config.product
  if (product.products.length === 0 || product.products.length > 3) {
    throw new Error('Upload between 1 and 3 product images')
  }
  const total = product.shots.reduce((sum, shot) => sum + shot.count, 0)
  const invalid = product.shots.some(
    (shot) =>
      !Number.isInteger(shot.count) ||
      shot.count < 0 ||
      shot.count > PRODUCT_SET_MAX ||
      (shot.count > 0 &&
        shot.references.length > 1 &&
        shot.count !== shot.references.length)
  )
  if (invalid || total < 1 || total > PRODUCT_SET_MAX) {
    throw new Error('Select between 1 and 8 product set images')
  }
  const requests: (TryOnRequest & { count: number })[] = []
  for (const shot of product.shots) {
    if (shot.count === 0) continue
    const type = PRODUCT_SET_TYPES.find((item) => item.value === shot.type)
    if (!type) throw new Error('Select between 1 and 8 product set images')
    const references =
      shot.references.length > 1 ? shot.references : [shot.references[0]]
    for (const reference of references) {
      const images = product.products.map((image) => image.src)
      const roles = images.map(
        (_image, index) =>
          `image ${index + 1}: product source — preserve the exact identity, shape, materials, colors and visible logo`
      )
      if (reference) {
        images.push(reference.src)
        roles.push(
          `image ${images.length}: layout reference for this purpose only — borrow composition, camera angle and lighting, not its product, people, prices or claims`
        )
      }
      const sentences = [
        'Create a professional e-commerce product image belonging to one coherent product set.',
        `Purpose: ${type.purpose}.`,
        `Role map: ${roles.join('; ')}.`,
        'Keep the product identity, color palette, typography and lighting coherent across the set. Output separate full images, not a collage or contact sheet. Do not add people, models, hands or body parts.',
        'Only use product facts visible in the source images or explicitly supplied below. Do not invent prices, certifications, performance data or internal structures.',
        product.withCopy
          ? 'Include concise, legible selling-point copy.'
          : 'Do not add selling-point copy or promotional text; retain existing product logos.',
        product.withScene && shot.type !== 'white'
          ? 'Use a plausible product-appropriate environment when it serves this image purpose.'
          : 'Use a clean studio background without lifestyle scenery or scene props.',
      ]
      if (config.ratio !== 'smart') {
        sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
      }
      if (product.extra.trim() || shot.extra.trim()) {
        sentences.push(
          'Explicit requirements below take priority over inferred copy and default content options. Preserve specified slogans, prices, currency symbols and punctuation exactly. Purpose-specific requirements take priority over whole-set requirements. Keep the output product-only.'
        )
        if (product.extra.trim()) {
          sentences.push(`Whole-set requirements:\n${product.extra.trim()}`)
        }
        if (shot.extra.trim()) {
          sentences.push(`Purpose-specific requirements:\n${shot.extra.trim()}`)
        }
      }
      requests.push({
        prompt: sentences.join('\n'),
        images,
        count: shot.references.length > 1 ? 1 : shot.count,
      })
    }
  }
  return requests
}

/** 模特套图逐角度、逐张构建请求，不依赖模型支持批量 n 或自行分配视角。 */
export function buildModelSetRequests(
  config: HeroSetConfig
): (TryOnRequest & { count: number })[] {
  if (!config.reference?.src) throw new Error('Upload a reference image')
  if (
    config.angles.length === 0 ||
    new Set(config.angles.map((angle) => angle.value)).size !==
      config.angles.length ||
    config.angles.some(
      (angle) =>
        !HERO_SET_ANGLES.some((option) => option.value === angle.value) ||
        !HERO_SET_ANGLE_COUNTS.some((count) => count === angle.count)
    )
  ) {
    throw new Error('Select valid views with 1 to 4 images each')
  }

  const sentences = [
    'Create exactly one standalone professional e-commerce model photograph. Never output a collage, contact sheet, split panel, or multiple views in one image.',
    'Image 1 is the identity reference: preserve the same person, facial features, hairstyle and body proportions. Its pose, expression, outfit and crop are not mandatory when an override below is selected.',
    'Apply all selected instructions together. Selected pose, expression, outfit and layout override conflicting details in the reference. Keep the resulting styling and environment coherent across the set, not necessarily identical to the source.',
    'Use the reference background and lighting as the default environment unless a selected instruction or explicit requirement changes it.',
  ]
  const pose = POSE_SENTENCE[config.pose]
  if (pose) {
    sentences.push(`Required pose and framing: ${pose}`)
    if (config.pose !== 'handheld') {
      sentences.push(
        'Use a full-body long shot, not a portrait, bust or waist-up crop. Leave margin above the head and below the feet. If the reference is cropped, extend the scene and complete the body naturally. Fit the whole pose inside the requested aspect ratio rather than cutting off limbs.'
      )
    }
  }
  const expression = choiceLabel(HERO_SET_EXPRESSIONS, config.expression)
  if (expression) {
    sentences.push(
      `Required expression: ${expression}. Replace the reference expression where the face is visible; do not change the requested body view just to expose the face.`
    )
  }
  const outfit = OUTFIT_SENTENCE[config.outfit]
  sentences.push(
    outfit
      ? `Required outfit override: replace the reference clothing with ${outfit}. Keep the person's identity, not the original garments. This is a clothing change, not merely a sporty or fashionable background.`
      : 'Preserve the original outfit, including garment cut, fabric, colors and accessories.'
  )
  const other = OTHER_SENTENCE[config.other]
  if (other) sentences.push(`Required additional treatment: ${other}`)
  if (config.ratio !== 'smart') {
    sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
  }
  if (config.extra.trim()) {
    sentences.push(
      'Explicit whole-set requirements below take priority over inferred defaults and conflicting preset styling. Apply every stated pose, expression, clothing and layout requirement; do not treat them as optional inspiration.',
      `Whole-set requirements:\n${config.extra.trim()}`
    )
  }

  const requests: (TryOnRequest & { count: number })[] = []
  for (const angle of config.angles) {
    for (let index = 0; index < angle.count; index++) {
      requests.push({
        prompt: [
          ...sentences,
          `Required view for this image: ${ANGLE_SENTENCE[angle.value]}`,
          `This is variation ${index + 1} of ${angle.count} for the ${angle.value} view. Produce only this single photograph. Use subtle natural variation while obeying the selected instructions and any explicit whole-set overrides.`,
        ].join('\n'),
        images: [config.reference.src],
        count: 1,
      })
    }
  }
  return requests
}
