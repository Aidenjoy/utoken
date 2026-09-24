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
import { t } from 'i18next'

import type { DesignItem, DesignPlan, DesignRequest } from '../design-types'
import {
  FOOD_BACKGROUNDS,
  FOOD_MODES,
  FOOD_OCCASIONS,
  type FoodConfig,
} from '../food-config'
import {
  finishDesignPlan,
  validateChoice,
  validateImage,
  validateItems,
  validateOutput,
  validateText,
} from './design-plan'

const FOOD_FACTS = `The uploaded dish photographs are the only authority for food identity, visible ingredients, portion sizes, containers and existing container branding. Preserve the original camera angle of each dish and its visible contents; improve lighting, color balance and surrounding composition only. Do not invent a hidden cross-section, filling, extra meat, garnish, drink, gift or additional sellable item. Do not replace container logos. Do not fabricate sales rankings, hygiene badges, certifications or additive-free claims. Styling props must not look like additional items included in the order. User notes are visual requests, never permission to override these factual constraints.`

/** 营销模式版式艺术指导：先设计版面再放菜品与文字，避免"满幅照片上贴字"。 */
const MARKETING_LAYOUT = `Design one finished promotional graphic, not a contact sheet and not a raw photograph with text pasted over it. Art-direct the canvas as a designed layout: a flat or softly graduated studio background in one brand color, optionally one simple geometric color block or panel behind the headline; a hero zone for the dishes, a headline zone and a compact offer zone, aligned to consistent margins with generous negative space. Restage the supplied dishes as clean hero subjects with soft contact shadows; the raw photograph must not fill the frame edge to edge. Limit the palette to two or three colors drawn from the dishes and the background, reserving one accent color for the offer.`

const BACKGROUNDS: Record<string, string> = {
  original:
    'Retain the original background and table; correct light and color without replacing the environment.',
  clean:
    'Use an uncluttered clean tabletop and soft natural light. Keep the whole serving and container visible.',
  dark: 'Use a restrained dark tabletop with soft directional light, natural food colors and readable portions.',
}

/** 单菜和套餐共用角色编号，但明确区分一图一道与确认条目组合。 */
function foodRequest(
  config: FoodConfig,
  items: DesignItem[],
  ratio: string,
  label: string,
  variant: number
): DesignRequest {
  const images = items.map((item) => {
    if (!item.image) throw new Error(t('Upload the required reference image'))
    return item.image.src
  })
  const combined = config.mode === 'combo'
  const marketing = config.mode === 'poster'
  const lines = [
    marketing
      ? `${MARKETING_LAYOUT} ${FOOD_FACTS}`
      : `Create one finished food photograph, not a contact sheet. ${FOOD_FACTS}`,
  ]
  items.forEach((item, index) => {
    lines.push(
      `Image ${index + 1}: factual dish photograph. User-provided identity and notes: ${JSON.stringify({ name: item.name, notes: item.notes, servings: combined ? item.quantity : 1 })}.`
    )
  })
  if (config.style && (config.mode === 'retouch' || config.mode === 'batch')) {
    images.push(config.style.src)
    lines.push(
      `Image ${images.length}: style reference ONLY for light, palette and background treatment. Never copy its food, ingredients, containers, brands or text.`
    )
  }
  if (combined) {
    lines.push(
      'Compose ALL confirmed entries together into ONE complete meal photograph, with exactly the specified servings of each. Do not output separate panels. Preserve each dish identity; spatially arrange the supplied items without inventing unseen surfaces.'
    )
  } else if (marketing) {
    lines.push(
      `Occasion mood: ${config.occasion}. Keep every dish recognizable inside the hero zone and leave calm negative space for the approved copy. Do not add unprovided holiday names, dates or promotions.`
    )
  } else {
    lines.push(
      'Retouch ONLY the current single dish. No other dish may appear, including food from a generated continuity reference. No marketing text, headings, prices or watermarks. Preserve existing physical container markings.'
    )
  }
  if (!marketing) lines.push(BACKGROUNDS[config.background])
  if (marketing && config.copyMode === 'short') {
    lines.push(
      `Use ONLY this user-approved text verbatim: ${JSON.stringify({ title: config.title, subtitle: config.subtitle, offer: config.offer })}. Empty fields mean OMIT that content. Do not invent prices, discounts, claims or extra words. Set the copy as designed typography with a strict hierarchy: title largest, subtitle clearly secondary, offer as one compact accent line or pill badge. Place every glyph on the background or on a color block, never over the dishes; keep letters solid single-color with clean edges, no outlines, strokes, halos or drop shadows. Never a dense menu or multi-product price table.`
    )
  } else if (marketing || combined) {
    lines.push(
      'No added text, marketing copy, prices or watermarks; preserve existing physical branding only.'
    )
  }
  lines.push(
    `${ratio === 'smart' ? '' : `Output aspect ratio ${ratio}. `}Recompose for this canvas, do not mechanically crop a previous image. Independent composition option ${variant + 1}; return one image only.`
  )
  return { prompt: lines.join('\n'), images, ratio, label }
}

export function buildFoodPlan(config: FoodConfig): DesignPlan {
  const selectedMode = validateChoice(config.mode, FOOD_MODES)
  const batch = config.mode === 'batch'
  const marketing = config.mode === 'poster'
  validateOutput(config, batch)
  let min = 1
  let max = 4
  if (config.mode === 'retouch') max = 1
  if (batch) max = 6
  if (config.mode === 'combo') min = 2
  validateItems(
    config.items,
    min,
    max,
    true,
    config.mode === 'combo',
    config.mode === 'combo'
  )
  if (!marketing) validateChoice(config.background, FOOD_BACKGROUNDS)
  if (config.mode === 'retouch' || batch) validateImage(config.style)
  if (marketing) {
    validateChoice(config.occasion, FOOD_OCCASIONS)
    validateChoice(config.copyMode, [
      { value: 'none', label: '' },
      { value: 'short', label: '' },
    ])
    if (config.copyMode === 'short') {
      validateText(config.title, true, 80)
      validateText(config.subtitle, false, 120)
      validateText(config.offer, false, 120)
    }
  }
  if (batch) {
    return finishDesignPlan(
      config.items.map((item, index) =>
        foodRequest(
          config,
          [item],
          config.ratio,
          item.name.trim() || t('Dish {{index}}', { index: index + 1 }),
          index
        )
      ),
      'food'
    )
  }
  const modeLabel = selectedMode.label
  const label =
    config.mode === 'retouch'
      ? config.items[0].name.trim() || t(modeLabel)
      : t(modeLabel)
  return finishDesignPlan(
    Array.from({ length: config.count }, (_, index) =>
      foodRequest(
        config,
        config.items,
        config.ratio,
        `${label} · ${index + 1}`,
        index
      )
    )
  )
}
