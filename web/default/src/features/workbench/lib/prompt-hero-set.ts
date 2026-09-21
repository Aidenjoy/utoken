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
  return config.angles.reduce((total, angle) => total + angle.count, 0)
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
