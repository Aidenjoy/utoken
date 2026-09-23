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
          `image ${index + 1}: product source — preserve the exact identity, shape, materials, colors and physical on-product logo; do not copy its background, layout, promotional text, price labels or watermarks`
      )
      const withScene =
        shot.type !== 'white' && (product.withScene || shot.type === 'scene')
      if (withScene && product.sceneImage?.src) {
        images.push(product.sceneImage.src)
        roles.push(
          `image ${images.length}: shared scene reference for the whole set — use this same location, background surfaces, props, palette and light direction; do not copy its products, people, text or branding`
        )
      }
      if (reference) {
        images.push(reference.src)
        roles.push(
          `image ${images.length}: layout reference for this purpose only — borrow composition and camera angle only where compatible with the required purpose and shared scene; never replace the shared background, lighting or palette, or copy its product, people, branding, text, prices or claims`
        )
        if (shot.type === 'white') {
          roles.push(
            'For this white-background packshot, the layout reference may guide only product orientation and framing. Discard its background, scenery, lighting gradients, shadows, props, typography and graphics'
          )
        }
      }
      const sentences = [
        'Create exactly one standalone professional e-commerce product image for the assigned purpose. Output only this image, never a collage, contact sheet or a sheet of the whole set.',
        `Required image type: ${type.label}.`,
        'Instruction priority: the required image purpose and its prohibitions are mandatory. Within those limits, purpose-specific requirements override whole-set requirements, which override default content options. References guide only compatible visual details. Do not blend other image purposes into this request.',
        `Purpose: ${type.purpose}`,
        `Role map: ${roles.join('; ')}.`,
        'This image belongs to one coordinated product photo shoot, not an independent design. Lock the exact same product identity, materials, true colors, lighting direction, color temperature, palette and retouching across the set. All scene-enabled images share one physical location, backdrop, surfaces and props; only purpose-specific framing, camera angle and close-up scale may change. Keep typography consistent wherever copy is permitted, without copying another image purpose or its text. White-background packshots are the explicit background exception. Do not add people, models, hands or body parts.',
        'Only use product facts visible in the source images or explicitly supplied below. Do not invent brand names, slogans, prices, certifications, performance data or internal structures. Instructions describe what to draw; do not print the instructions themselves.',
      ]
      if (shot.type === 'white') {
        sentences.push(
          'Copy and scene policy for this image: disabled regardless of whole-set options. Ignore any conflicting request for a slogan, price, promotional overlay, lifestyle scene or colored background, including requests in the notes below. Retain only markings physically present on the product.'
        )
      } else {
        sentences.push(
          product.withCopy
            ? 'Include concise, legible selling-point copy only where it supports this image purpose. Keep supplied copy in its original language and spelling; do not invent a new brand or slogan.'
            : 'Do not add selling-point copy or promotional text unless explicitly supplied in compatible requirements below; retain existing product logos.'
        )
        if (withScene) {
          sentences.push(
            product.sceneImage?.src
              ? 'Use the uploaded shared scene as the required environment, not optional inspiration. Keep its recognizable background and lighting throughout the set. Adapt product placement and crop to the assigned purpose; do not switch locations or erase the scene.'
              : 'Establish one realistic product-appropriate usage environment for the whole set, with neutral surfaces, soft daylight from the left and minimal fixed props. Reuse that same location and lighting in every scene-enabled image; never invent a new setting per image.',
            'Keep the shared environment subordinate to the assigned product framing. For detail and structure images show a close-up within the same setting, not a distant lifestyle shot.'
          )
          if (shot.type === 'scene') {
            sentences.push(
              'A recognizable product-appropriate usage environment is required for this scene image, not optional; the product must remain the focal point.'
            )
          }
        } else {
          sentences.push(
            'Use a clean studio background without lifestyle scenery or scene props unless compatible explicit requirements specify otherwise. Reuse the same studio backdrop and lighting across these images.'
          )
        }
      }
      if (config.ratio !== 'smart') {
        sentences.push(`Compose the frame in a ${config.ratio} aspect ratio.`)
      }
      if (product.extra.trim() || shot.extra.trim()) {
        sentences.push(
          'Apply the requirements below only where compatible with the mandatory image purpose and its prohibitions. Purpose-specific requirements take priority over whole-set requirements and default content options, but cannot change the assigned image type. When added copy is permitted, preserve specified slogans, prices, currency symbols and punctuation exactly. Keep the output product-only.'
        )
        if (product.extra.trim()) {
          sentences.push(`Whole-set requirements:\n${product.extra.trim()}`)
        }
        if (shot.extra.trim()) {
          sentences.push(`Purpose-specific requirements:\n${shot.extra.trim()}`)
        }
      }
      sentences.push(
        `Final image check: deliver only the ${type.label.toLowerCase()} described above.`,
        shot.type === 'white'
          ? 'The finished image must show only the complete product on uniform #FFFFFF, with no added text or scenery. Remove any conflicting background, overlay or decoration before returning the image.'
          : 'Check that the assigned purpose is visually evident, product identity is unchanged and no unsupported claims or content from another purpose have been added.'
      )
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

  const images = [config.reference.src]
  const sentences = [
    'Create exactly one standalone professional e-commerce model photograph belonging to one continuous photo shoot. Never output a collage, contact sheet, split panel, or multiple views in one image.',
    'Image 1 is the identity reference: preserve the same person, facial features, hairstyle, skin tone and body proportions. Its pose, expression, outfit and crop are not mandatory when an override below is selected.',
    'Set consistency is mandatory: every image must show the exact same person wearing the exact same outfit and accessories in the same physical scene, with identical background elements, light direction, color temperature, exposure, palette and photographic treatment. Keep camera height, lens perspective and framing scale consistent. Only the requested body view and natural pose or expression may vary; do not redesign the scene or restyle the model for each image.',
    'Apply selected styling and explicit whole-set requirements once to establish the shared look, then preserve it throughout the set. An outfit preset means one specific outfit reused in every image, not different outfits of the same style.',
  ]
  if (config.sceneImage?.src) {
    images.push(config.sceneImage.src)
    sentences.push(
      'Image 2 is the shared scene reference: use its location, background surfaces, fixed props, depth and lighting for every image, replacing the background of image 1. Borrow only the environment, never its people, clothing, products, text or branding. Keep this background recognizable and place the model naturally in it with correct scale and contact shadows.'
    )
  } else {
    sentences.push(
      'Use the reference background and lighting as the shared environment unless explicit whole-set requirements change it. If the reference is a cutout, transparent or has no usable environment, establish one light-gray photographic studio with a visible floor, subtle backdrop depth and soft light from the left, and reuse it in every image.'
    )
  }
  sentences.push(
    'Always render a complete background with natural subject contact and depth; never return a transparent cutout, an isolated floating person or remove the environment. Any requested background adjustment applies identically to the whole set.'
  )
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
          `This is variation ${index + 1} of ${angle.count} for the ${angle.value} view. Produce only this single photograph from the same shoot. Vary only a natural hand position, weight shift or expression within the selected pose and view; keep clothing, accessories, background, lighting and framing scale unchanged. Obey all explicit whole-set requirements.`,
          `Pose variation cue: ${['relaxed hands and balanced posture', 'a subtle weight shift and a different relaxed hand position', 'a small natural arm adjustment', 'a gentle head tilt with relaxed shoulders'][index]}. Adapt this cue to the required pose and view without overriding them.`,
        ].join('\n'),
        images: [...images],
        count: 1,
      })
    }
  }
  return requests
}
