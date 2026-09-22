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
import { ArrowRight, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import conceptBoardThumb from '@/assets/hero/product-creative-cross-inspiration-thumb.webp'
import conceptBoardPreview from '@/assets/hero/product-creative-cross-inspiration.webp'
import beforeAfterThumb from '@/assets/hero/product-creative-identity-redesign-thumb.webp'
import beforeAfterPreview from '@/assets/hero/product-creative-identity-redesign.webp'
import conceptStripThumb from '@/assets/hero/product-creative-keyword-divergence-thumb.webp'
import conceptStripPreview from '@/assets/hero/product-creative-keyword-divergence.webp'
import fourWayThumb from '@/assets/hero/product-creative-multi-direction-thumb.webp'
import fourWayPreview from '@/assets/hero/product-creative-multi-direction.webp'
import creativeSource from '@/assets/hero/product-creative-source.webp'
import nineGridThumb from '@/assets/hero/product-creative-viral-nine-grid-thumb.webp'
import nineGridPreview from '@/assets/hero/product-creative-viral-nine-grid.webp'
import freeDesignPreview from '@/assets/hero/product-free-design-example.webp'
import easyRepairThumb from '@/assets/hero/product-function-easy-repair-thumb.webp'
import easyRepairPreview from '@/assets/hero/product-function-easy-repair.webp'
import ergonomicThumb from '@/assets/hero/product-function-ergonomic-thumb.webp'
import ergonomicPreview from '@/assets/hero/product-function-ergonomic.webp'
import quickOperationThumb from '@/assets/hero/product-function-quick-operation-thumb.webp'
import quickOperationPreview from '@/assets/hero/product-function-quick-operation.webp'
import safetyBoostThumb from '@/assets/hero/product-function-safety-boost-thumb.webp'
import safetyBoostPreview from '@/assets/hero/product-function-safety-boost.webp'
import sceneExtensionThumb from '@/assets/hero/product-function-scene-extension-thumb.webp'
import sceneExtensionPreview from '@/assets/hero/product-function-scene-extension.webp'
import functionSource from '@/assets/hero/product-function-source.webp'
import ecoSwapThumb from '@/assets/hero/product-material-eco-swap-thumb.webp'
import ecoSwapPreview from '@/assets/hero/product-material-eco-swap.webp'
import multiMaterialThumb from '@/assets/hero/product-material-multi-material-thumb.webp'
import multiMaterialPreview from '@/assets/hero/product-material-multi-material.webp'
import premiumCraftThumb from '@/assets/hero/product-material-premium-craft-thumb.webp'
import premiumCraftPreview from '@/assets/hero/product-material-premium-craft.webp'
import seriesExtensionThumb from '@/assets/hero/product-material-series-extension-thumb.webp'
import seriesExtensionPreview from '@/assets/hero/product-material-series-extension.webp'
import materialSource from '@/assets/hero/product-material-source.webp'
import textureGlossThumb from '@/assets/hero/product-material-texture-gloss-thumb.webp'
import textureGlossPreview from '@/assets/hero/product-material-texture-gloss.webp'
import cmfBoardThumb from '@/assets/hero/product-proposal-cmf-board-thumb.webp'
import cmfBoardPreview from '@/assets/hero/product-proposal-cmf-board.webp'
import compareBoardThumb from '@/assets/hero/product-proposal-compare-board-thumb.webp'
import compareBoardPreview from '@/assets/hero/product-proposal-compare-board.webp'
import fullBoardThumb from '@/assets/hero/product-proposal-full-board-thumb.webp'
import fullBoardPreview from '@/assets/hero/product-proposal-full-board.webp'
import landingBoardThumb from '@/assets/hero/product-proposal-landing-board-thumb.webp'
import landingBoardPreview from '@/assets/hero/product-proposal-landing-board.webp'
import proposalSource from '@/assets/hero/product-proposal-source.webp'
import structureBoardThumb from '@/assets/hero/product-proposal-structure-board-thumb.webp'
import structureBoardPreview from '@/assets/hero/product-proposal-structure-board.webp'
import foldingThumb from '@/assets/hero/product-redesign-folding-storage-thumb.webp'
import foldingPreview from '@/assets/hero/product-redesign-folding-storage.webp'
import interiorThumb from '@/assets/hero/product-redesign-interior-space-thumb.webp'
import interiorPreview from '@/assets/hero/product-redesign-interior-space.webp'
import modularThumb from '@/assets/hero/product-redesign-modular-disassembly-thumb.webp'
import modularPreview from '@/assets/hero/product-redesign-modular-disassembly.webp'
import partSwapThumb from '@/assets/hero/product-redesign-part-swap-thumb.webp'
import partSwapPreview from '@/assets/hero/product-redesign-part-swap.webp'
import proportionThumb from '@/assets/hero/product-redesign-proportion-rebuild-thumb.webp'
import proportionPreview from '@/assets/hero/product-redesign-proportion-rebuild.webp'
import redesignSource from '@/assets/hero/product-redesign-source.webp'
import accessoriesThumb from '@/assets/hero/product-series-accessories-thumb.webp'
import accessoriesPreview from '@/assets/hero/product-series-accessories.webp'
import familyNineGridThumb from '@/assets/hero/product-series-family-nine-grid-thumb.webp'
import familyNineGridPreview from '@/assets/hero/product-series-family-nine-grid.webp'
import lineupComboThumb from '@/assets/hero/product-series-lineup-combo-thumb.webp'
import lineupComboPreview from '@/assets/hero/product-series-lineup-combo.webp'
import sizeSceneThumb from '@/assets/hero/product-series-size-scene-thumb.webp'
import sizeScenePreview from '@/assets/hero/product-series-size-scene.webp'
import seriesSource from '@/assets/hero/product-series-source.webp'
import tiersThumb from '@/assets/hero/product-series-tiers-thumb.webp'
import tiersPreview from '@/assets/hero/product-series-tiers.webp'
import colorPatternThumb from '@/assets/hero/product-visual-color-pattern-thumb.webp'
import colorPatternPreview from '@/assets/hero/product-visual-color-pattern.webp'
import fashionFusionThumb from '@/assets/hero/product-visual-fashion-fusion-thumb.webp'
import fashionFusionPreview from '@/assets/hero/product-visual-fashion-fusion.webp'
import futureTechThumb from '@/assets/hero/product-visual-future-tech-thumb.webp'
import futureTechPreview from '@/assets/hero/product-visual-future-tech.webp'
import orientalThumb from '@/assets/hero/product-visual-oriental-thumb.webp'
import orientalPreview from '@/assets/hero/product-visual-oriental.webp'
import outdoorFunctionalThumb from '@/assets/hero/product-visual-outdoor-functional-thumb.webp'
import outdoorFunctionalPreview from '@/assets/hero/product-visual-outdoor-functional.webp'
import visualSource from '@/assets/hero/product-visual-source.webp'

import { DESIGN_BOARD_TYPES } from '../constants'
import type { DesignPreset } from '../types'
import { BoardGlyph } from './board-glyph'
import { ShowcaseHint } from './showcase-hint'

/** 卡片使用小图，右侧使用同一案例的大图，避免首屏加载全部大图。 */
const PRODUCT_DESIGN_CASES: Partial<
  Record<string, { src: string; thumbnail: string; source: string }>
> = {
  'viral-nine-grid': {
    src: nineGridPreview,
    thumbnail: nineGridThumb,
    source: creativeSource,
  },
  'cross-inspiration': {
    src: conceptBoardPreview,
    thumbnail: conceptBoardThumb,
    source: creativeSource,
  },
  'identity-redesign': {
    src: beforeAfterPreview,
    thumbnail: beforeAfterThumb,
    source: creativeSource,
  },
  'keyword-divergence': {
    src: conceptStripPreview,
    thumbnail: conceptStripThumb,
    source: creativeSource,
  },
  'multi-direction': {
    src: fourWayPreview,
    thumbnail: fourWayThumb,
    source: creativeSource,
  },
  'folding-storage': {
    src: foldingPreview,
    thumbnail: foldingThumb,
    source: redesignSource,
  },
  'interior-space': {
    src: interiorPreview,
    thumbnail: interiorThumb,
    source: redesignSource,
  },
  'modular-disassembly': {
    src: modularPreview,
    thumbnail: modularThumb,
    source: redesignSource,
  },
  'part-swap': {
    src: partSwapPreview,
    thumbnail: partSwapThumb,
    source: redesignSource,
  },
  'proportion-rebuild': {
    src: proportionPreview,
    thumbnail: proportionThumb,
    source: redesignSource,
  },
  ergonomic: {
    src: ergonomicPreview,
    thumbnail: ergonomicThumb,
    source: functionSource,
  },
  'scene-extension': {
    src: sceneExtensionPreview,
    thumbnail: sceneExtensionThumb,
    source: functionSource,
  },
  'quick-operation': {
    src: quickOperationPreview,
    thumbnail: quickOperationThumb,
    source: functionSource,
  },
  'safety-boost': {
    src: safetyBoostPreview,
    thumbnail: safetyBoostThumb,
    source: functionSource,
  },
  'easy-repair': {
    src: easyRepairPreview,
    thumbnail: easyRepairThumb,
    source: functionSource,
  },
  'same-material-extension': {
    src: seriesExtensionPreview,
    thumbnail: seriesExtensionThumb,
    source: materialSource,
  },
  'multi-material': {
    src: multiMaterialPreview,
    thumbnail: multiMaterialThumb,
    source: materialSource,
  },
  'premium-craft': {
    src: premiumCraftPreview,
    thumbnail: premiumCraftThumb,
    source: materialSource,
  },
  'texture-gloss': {
    src: textureGlossPreview,
    thumbnail: textureGlossThumb,
    source: materialSource,
  },
  'eco-swap': {
    src: ecoSwapPreview,
    thumbnail: ecoSwapThumb,
    source: materialSource,
  },
  'color-pattern': {
    src: colorPatternPreview,
    thumbnail: colorPatternThumb,
    source: visualSource,
  },
  'fashion-fusion': {
    src: fashionFusionPreview,
    thumbnail: fashionFusionThumb,
    source: visualSource,
  },
  oriental: {
    src: orientalPreview,
    thumbnail: orientalThumb,
    source: visualSource,
  },
  'future-tech': {
    src: futureTechPreview,
    thumbnail: futureTechThumb,
    source: visualSource,
  },
  'outdoor-functional': {
    src: outdoorFunctionalPreview,
    thumbnail: outdoorFunctionalThumb,
    source: visualSource,
  },
  accessories: {
    src: accessoriesPreview,
    thumbnail: accessoriesThumb,
    source: seriesSource,
  },
  'lineup-combo': {
    src: lineupComboPreview,
    thumbnail: lineupComboThumb,
    source: seriesSource,
  },
  tiers: {
    src: tiersPreview,
    thumbnail: tiersThumb,
    source: seriesSource,
  },
  'family-nine-grid': {
    src: familyNineGridPreview,
    thumbnail: familyNineGridThumb,
    source: seriesSource,
  },
  'size-scene': {
    src: sizeScenePreview,
    thumbnail: sizeSceneThumb,
    source: seriesSource,
  },
  'compare-board': {
    src: compareBoardPreview,
    thumbnail: compareBoardThumb,
    source: proposalSource,
  },
  'cmf-board': {
    src: cmfBoardPreview,
    thumbnail: cmfBoardThumb,
    source: proposalSource,
  },
  'structure-board': {
    src: structureBoardPreview,
    thumbnail: structureBoardThumb,
    source: proposalSource,
  },
  'landing-board': {
    src: landingBoardPreview,
    thumbnail: landingBoardThumb,
    source: proposalSource,
  },
  'full-board': {
    src: fullBoardPreview,
    thumbnail: fullBoardThumb,
    source: proposalSource,
  },
}

const CHIP_CLASS =
  'bg-foreground/70 text-background absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px]'

interface ProductPresetCaseProps {
  preset: DesignPreset
}

/** 案例卡体：商品原图到生成设计板的对照，无案例时回退抽象板图。 */
export function ProductPresetCase(props: ProductPresetCaseProps) {
  const { t } = useTranslation()
  const preview = PRODUCT_DESIGN_CASES[props.preset.value]
  if (!preview) {
    const board = DESIGN_BOARD_TYPES[props.preset.boardType]
    return <BoardGlyph kind={board?.glyph ?? 'collage'} />
  }
  return (
    <div className='flex items-stretch gap-1.5'>
      <figure className='relative min-w-0 flex-1'>
        <img
          src={preview.source}
          alt=''
          width={360}
          height={480}
          decoding='async'
          className='aspect-[3/4] w-full rounded-md object-cover'
        />
        <figcaption className={CHIP_CLASS}>{t('Source image')}</figcaption>
      </figure>
      <ArrowRight
        className='text-primary my-auto size-4 shrink-0'
        aria-hidden='true'
      />
      <figure className='relative min-w-0 flex-1'>
        <img
          src={preview.thumbnail}
          alt=''
          width={480}
          height={480}
          decoding='async'
          className='aspect-square w-full rounded-md object-cover'
        />
        <figcaption className={CHIP_CLASS}>{t('Generated image')}</figcaption>
      </figure>
    </div>
  )
}

interface ProductShowcaseProps {
  preset: DesignPreset | null
}

/** 案例图文展示；自由设计等无案例方向展示通用示例，仅在尚未生成时出现在右侧。 */
export function ProductShowcase(props: ProductShowcaseProps) {
  const { t } = useTranslation()
  const descriptions: Partial<Record<string, string>> = {
    'viral-nine-grid': t(
      'Split one hero product into nine sellable variations across colorways and scenes.'
    ),
    'cross-inspiration': t(
      'Fuse the product with inspiration from other categories into fresh concept renders.'
    ),
    'identity-redesign': t(
      'Redesign the product while keeping its core identity recognizable.'
    ),
    'keyword-divergence': t(
      'Diverge from style keywords into distinct concept sketches of one product.'
    ),
    'multi-direction': t(
      'Explore four clearly different design directions for the same product.'
    ),
    'folding-storage': t(
      'Rework the product around a folding storage mechanism with clear deploy steps.'
    ),
    'interior-space': t(
      'Optimize the internal space division and show the organized interior layout.'
    ),
    'modular-disassembly': t(
      'Restructure the product into swappable modules with clean parting lines.'
    ),
    'part-swap': t(
      'Add, remove and swap functional parts with annotated before and after views.'
    ),
    'proportion-rebuild': t(
      'Rebuild the proportions and silhouette for a more premium stance.'
    ),
    ergonomic: t(
      'Optimize carrying and handling ergonomics with human-factors evidence.'
    ),
    'scene-extension': t(
      'Extend the product into new usage scenes with scene-specific functions.'
    ),
    'quick-operation': t(
      'Design one-hand carry and seconds-level quick-access operations.'
    ),
    'safety-boost': t(
      'Map usage risks and answer each with a visible protection design.'
    ),
    'easy-repair': t(
      'Make wear parts tool-free to replace and show the maintenance path.'
    ),
    'same-material-extension': t(
      'Extend the signature material into a family of companion products.'
    ),
    'multi-material': t(
      'Combine two to three materials in refined CMF combinations.'
    ),
    'premium-craft': t(
      'Elevate the product with limited-edition premium craft details.'
    ),
    'texture-gloss': t(
      'Study surface texture and gloss levels across macro detail cells.'
    ),
    'eco-swap': t(
      'Swap to recycled or bio-based materials without losing the premium feel.'
    ),
    'color-pattern': t(
      'Build a systematic colorway and pattern family for the product.'
    ),
    'fashion-fusion': t(
      'Fuse current fashion-brand visual language into the product styling.'
    ),
    oriental: t(
      'Translate oriental aesthetics into form, material and color cues.'
    ),
    'future-tech': t(
      'Restyle the product in a futuristic high-tech visual language.'
    ),
    'outdoor-functional': t(
      'Dress the product in an outdoor functional design language with field scenes.'
    ),
    accessories: t(
      'Design a matching accessory ecosystem around the hero product.'
    ),
    'lineup-combo': t(
      'Plan hero, image and profit models as one coherent lineup.'
    ),
    tiers: t(
      'Define entry, standard and premium editions with visible value deltas.'
    ),
    'family-nine-grid': t(
      'Arrange the whole product family as a nine-grid series matrix.'
    ),
    'size-scene': t('Show multiple sizes staged in their best-fit scenes.'),
    'compare-board': t(
      'Place the original and the proposal side by side for a decision-ready review.'
    ),
    'cmf-board': t(
      'Present color, material and finish options with swatches and renders.'
    ),
    'structure-board': t(
      'Break the product into modules with an engineering-ready exploded view.'
    ),
    'landing-board': t(
      'Turn the design into a production landing plan with DFM notes.'
    ),
    'full-board': t(
      'Compose hero shot, details, CMF and specs into one explanation board.'
    ),
  }
  const preset = props.preset
  const preview = preset ? PRODUCT_DESIGN_CASES[preset.value] : undefined
  const caption =
    preset && preview ? t(preset.label) : t('Merchandise design examples')
  const description =
    (preset && descriptions[preset.value]) ||
    t('Write a custom brief and the design board follows your idea.')

  return (
    <section
      aria-label={t('Example preview')}
      className='dark:bg-muted/30 border-border flex min-h-[420px] min-w-0 flex-1 flex-col justify-center gap-5 overflow-hidden rounded-xl border bg-[#edf3f0] p-4 sm:p-6'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{t('Generated result')}</span>
        <span className='text-muted-foreground text-xs'>
          {t('Example preview')}
        </span>
      </div>
      <figure className='flex min-h-[240px] flex-1 items-center justify-center'>
        <img
          src={preview?.src ?? freeDesignPreview}
          alt={caption}
          width={1200}
          height={1200}
          decoding='async'
          className='border-border max-h-full w-auto max-w-full rounded-xl border shadow-sm'
        />
      </figure>
      <ShowcaseHint
        icon={Package}
        title={caption}
        description={description}
        badges={[t('Creative extension'), t('Redesign'), t('Material & craft')]}
      />
    </section>
  )
}
