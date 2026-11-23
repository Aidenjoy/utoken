import {
  ARK_IMAGE_OUTPUT_FORMATS,
  ARK_IMAGE_SIZES,
  ARK_PRO_IMAGE_SIZES,
  IMAGE_ASPECT_RATIOS,
  IMAGE_COUNT_RANGE,
  OPENAI_IMAGE_OUTPUT_FORMATS,
  OPENAI_IMAGE_SIZES,
} from '../constants'
import type { ImageConfig, ImageOutputFormat } from '../types'

export interface ImageModelProfile {
  /** Accepted sizes in display order (ascending pixel area) */
  sizes: readonly string[]
  /** Fallback for a stale stored value; independent of the display order */
  defaultSize: string
  /** Accepted output formats; empty means the field must be omitted entirely */
  outputFormats: readonly ImageOutputFormat[]
  /** Images one request can return; 1 hides the count control */
  maxCount: number
  /** Resolution tiers pair with an aspect-ratio picker (Ark); WxH-only
   * providers (OpenAI) hide it */
  supportsRatio: boolean
}

// Volcengine Ark and OpenAI-compatible providers disagree on the size
// vocabulary, the output formats and how several images are asked for, and Ark
// rejects a value it does not know with a 400 instead of falling back to its
// default (its total-pixel floor is 3,686,400, well above the OpenAI 1024x1024
// presets). Offer only what the selected model accepts.
export function getImageModelProfile(model: string): ImageModelProfile {
  if (!/seedream|doubao|jimeng|volc|ark/i.test(model)) {
    return {
      sizes: OPENAI_IMAGE_SIZES,
      defaultSize: '1024x1024',
      outputFormats: OPENAI_IMAGE_OUTPUT_FORMATS,
      maxCount: IMAGE_COUNT_RANGE.max,
      supportsRatio: false,
    }
  }

  // Seedream 5.0 Pro takes the 1K/1.5K/2K/4K tiers and rejects both
  // sequential_image_generation and stream outright, so it always returns
  // exactly one image.
  if (/pro/i.test(model)) {
    return {
      sizes: ARK_PRO_IMAGE_SIZES,
      defaultSize: '2K',
      outputFormats: ARK_IMAGE_OUTPUT_FORMATS,
      maxCount: 1,
      supportsRatio: true,
    }
  }

  // output_format is documented for Seedream 5.0 only; the 4.x line returns
  // jpeg and has no such parameter. An unversioned alias gets the same treatment
  // as 4.x, which is the documented default for the whole Ark image API.
  const isSeedream5 = /seedream[-_.]?5/i.test(model)
  return {
    sizes: ARK_IMAGE_SIZES,
    defaultSize: '2K',
    outputFormats: isSeedream5 ? ARK_IMAGE_OUTPUT_FORMATS : [],
    maxCount: IMAGE_COUNT_RANGE.max,
    supportsRatio: true,
  }
}

/**
 * A config outlives the model it was picked for: switching between an Ark and an
 * OpenAI-compatible model, or between Seedream 5.0 and 5.0 Pro, leaves a size, a
 * format or a count the new model answers with a 400. Clamp all three to the new
 * profile so the request that goes out always uses the provider's vocabulary.
 */
export function normalizeImageConfig(
  config: ImageConfig,
  model: string
): ImageConfig {
  const profile = getImageModelProfile(model)
  const next: ImageConfig = { ...config, model }
  if (!profile.sizes.includes(next.size)) {
    next.size = profile.defaultSize
  }
  if (
    !profile.supportsRatio ||
    (next.ratio !== 'auto' &&
      !(IMAGE_ASPECT_RATIOS as readonly string[]).includes(next.ratio))
  ) {
    next.ratio = 'auto'
  }
  if (!profile.outputFormats.includes(next.outputFormat)) {
    next.outputFormat = profile.outputFormats[0] ?? next.outputFormat
  }
  if (next.count > profile.maxCount) {
    next.count = profile.maxCount
  }
  return next
}

/**
 * Stable id for playground images, used as a React key and as the handle for
 * removing a reference image. crypto.randomUUID() only exists in secure
 * contexts and the playground can be served over plain HTTP, so fall back to a
 * random suffix.
 */
export function createImageId(prefix: string): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}
