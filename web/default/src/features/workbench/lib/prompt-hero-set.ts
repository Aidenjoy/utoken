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
  HERO_SET_EXPRESSIONS,
  HERO_SET_OTHERS,
  HERO_SET_OUTFITS,
  HERO_SET_POSES,
  HERO_SET_SCENES,
  PRODUCT_SET_MAX,
  PRODUCT_SET_TYPES,
} from '../constants'
import type { ChipOption, HeroSetConfig } from '../types'
import type { TryOnRequest } from './prompt'

const ROLE_SENTENCE = {
  model:
    'model reference — keep the same person identity, outfit and scene across the whole set',
  product:
    'product reference — keep the product identity, shape and finish exact across the whole set',
}

const ANGLE_LABEL: Record<string, string> = {
  front: 'front',
  side: 'side',
  back: 'back',
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

/**
 * Fuse the single reference shot with the per-angle output plan into one
 * OpenAI-compatible image body; the prompt carries the identity lock plus
 * the angle plan so every output stays in the same series.
 */
export function buildHeroSetRequest(config: HeroSetConfig): TryOnRequest {
  const sentences = ['Professional e-commerce image set studio render.']
  if (config.reference) {
    sentences.push(`Image 1: ${ROLE_SENTENCE[config.mode]}.`)
  }
  const plan = config.angles.map(
    (angle) =>
      `${angle.count} image(s) from the ${ANGLE_LABEL[angle.value] ?? angle.value} view`
  )
  sentences.push(`Angle plan: ${plan.join('; ')}.`)
  sentences.push(
    config.mode === 'model'
      ? 'Keep the person, clothing and background consistent across all images in the set.'
      : 'Keep the product, lighting and background consistent across all images in the set.'
  )
  const pose = choiceLabel(HERO_SET_POSES, config.pose)
  if (pose) {
    sentences.push(
      config.mode === 'model'
        ? `Change the pose to: ${pose}.`
        : `Display pose: ${pose}.`
    )
  }
  if (config.mode === 'model') {
    const expression = choiceLabel(HERO_SET_EXPRESSIONS, config.expression)
    if (expression) {
      sentences.push(`Adjust the model expression: ${expression}.`)
    }
    const outfit = choiceLabel(HERO_SET_OUTFITS, config.outfit)
    if (outfit) sentences.push(`Outfit: ${outfit}.`)
  } else {
    const scene = choiceLabel(HERO_SET_SCENES, config.scene)
    if (scene) sentences.push(`Scene: ${scene}.`)
  }
  const other = choiceLabel(HERO_SET_OTHERS, config.other)
  if (other) sentences.push(`Other requirements: ${other}.`)
  if (config.extra.trim()) {
    sentences.push(
      `Additional requirements for the whole set: ${config.extra.trim()}.`
    )
  }
  sentences.push(
    'Same-series e-commerce image set, consistent identity and styling, studio lighting.'
  )
  if (config.ratio !== 'smart') {
    sentences.push(`Compose every frame in a ${config.ratio} aspect ratio.`)
  }

  return {
    prompt: sentences.join(' '),
    images: config.reference ? [config.reference.src] : [],
  }
}
