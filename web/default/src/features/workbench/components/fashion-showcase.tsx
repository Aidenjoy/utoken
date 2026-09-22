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
import { Shirt } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import backgroundThumb from '@/assets/hero/fashion-bg-tone-thumb.webp'
import backgroundPreview from '@/assets/hero/fashion-bg-tone.webp'
import descriptionThumb from '@/assets/hero/fashion-description-redesign-thumb.webp'
import descriptionPreview from '@/assets/hero/fashion-description-redesign.webp'
import descriptionStyleThumb from '@/assets/hero/fashion-description-style-thumb.webp'
import descriptionStylePreview from '@/assets/hero/fashion-description-style.webp'
import detailStyleThumb from '@/assets/hero/fashion-detail-style-thumb.webp'
import detailStylePreview from '@/assets/hero/fashion-detail-style.webp'
import fabricRecolorThumb from '@/assets/hero/fashion-fabric-recolor-thumb.webp'
import fabricRecolorPreview from '@/assets/hero/fashion-fabric-recolor.webp'
import fabricStyleThumb from '@/assets/hero/fashion-fabric-style-thumb.webp'
import fabricStylePreview from '@/assets/hero/fashion-fabric-style.webp'
import fabricThumb from '@/assets/hero/fashion-fabric-swap-thumb.webp'
import fabricPreview from '@/assets/hero/fashion-fabric-swap.webp'
import repeatThumb from '@/assets/hero/fashion-four-way-repeat-thumb.webp'
import repeatPreview from '@/assets/hero/fashion-four-way-repeat.webp'
import recolorThumb from '@/assets/hero/fashion-garment-recolor-thumb.webp'
import recolorPreview from '@/assets/hero/fashion-garment-recolor.webp'
import lineartExtractThumb from '@/assets/hero/fashion-lineart-extract-thumb.webp'
import lineartExtractPreview from '@/assets/hero/fashion-lineart-extract.webp'
import lineartStyleThumb from '@/assets/hero/fashion-lineart-style-thumb.webp'
import lineartStylePreview from '@/assets/hero/fashion-lineart-style.webp'
import extractThumb from '@/assets/hero/fashion-pattern-extract-thumb.webp'
import extractPreview from '@/assets/hero/fashion-pattern-extract.webp'
import fusionThumb from '@/assets/hero/fashion-pattern-fusion-thumb.webp'
import fusionPreview from '@/assets/hero/fashion-pattern-fusion.webp'
import patternThumb from '@/assets/hero/fashion-pattern-swap-thumb.webp'
import patternPreview from '@/assets/hero/fashion-pattern-swap.webp'
import fashionPreview from '@/assets/hero/fashion-preview.webp'
import removalThumb from '@/assets/hero/fashion-print-removal-thumb.webp'
import removalPreview from '@/assets/hero/fashion-print-removal.webp'
import referenceThumb from '@/assets/hero/fashion-reference-redesign-thumb.webp'
import referencePreview from '@/assets/hero/fashion-reference-redesign.webp'
import seriesFabricThumb from '@/assets/hero/fashion-series-fabric-thumb.webp'
import seriesFabricPreview from '@/assets/hero/fashion-series-fabric.webp'
import seriesReferenceThumb from '@/assets/hero/fashion-series-reference-thumb.webp'
import seriesReferencePreview from '@/assets/hero/fashion-series-reference.webp'
import seriesVariationThumb from '@/assets/hero/fashion-series-variation-thumb.webp'
import seriesVariationPreview from '@/assets/hero/fashion-series-variation.webp'
import similarThumb from '@/assets/hero/fashion-similar-pattern-thumb.webp'
import similarPreview from '@/assets/hero/fashion-similar-pattern.webp'
import transferThumb from '@/assets/hero/fashion-style-transfer-thumb.webp'
import transferPreview from '@/assets/hero/fashion-style-transfer.webp'
import proposalThumb from '@/assets/hero/fashion-viral-proposal-thumb.webp'
import proposalPreview from '@/assets/hero/fashion-viral-proposal.webp'
import splitThumb from '@/assets/hero/fashion-viral-split-thumb.webp'
import splitPreview from '@/assets/hero/fashion-viral-split.webp'

import type { FashionPreset } from '../types'
import { BoardGlyph } from './board-glyph'
import { ShowcaseHint } from './showcase-hint'

/** 卡片使用小图，右侧使用同一案例的大图，避免首屏加载全部大图。 */
const FASHION_PRESET_PREVIEWS: Partial<
  Record<string, { src: string; thumbnail: string }>
> = {
  'fabric-swap': { src: fabricPreview, thumbnail: fabricThumb },
  'pattern-swap': { src: patternPreview, thumbnail: patternThumb },
  'garment-recolor': { src: recolorPreview, thumbnail: recolorThumb },
  'description-redesign': {
    src: descriptionPreview,
    thumbnail: descriptionThumb,
  },
  'reference-redesign': { src: referencePreview, thumbnail: referenceThumb },
  'print-removal': { src: removalPreview, thumbnail: removalThumb },
  'viral-split': { src: splitPreview, thumbnail: splitThumb },
  'viral-proposal': { src: proposalPreview, thumbnail: proposalThumb },
  'detail-style': { src: detailStylePreview, thumbnail: detailStyleThumb },
  'fabric-style': { src: fabricStylePreview, thumbnail: fabricStyleThumb },
  'description-style': {
    src: descriptionStylePreview,
    thumbnail: descriptionStyleThumb,
  },
  'series-variation': {
    src: seriesVariationPreview,
    thumbnail: seriesVariationThumb,
  },
  'series-fabric': { src: seriesFabricPreview, thumbnail: seriesFabricThumb },
  'series-reference': {
    src: seriesReferencePreview,
    thumbnail: seriesReferenceThumb,
  },
  'pattern-extract': { src: extractPreview, thumbnail: extractThumb },
  'four-way-repeat': { src: repeatPreview, thumbnail: repeatThumb },
  'style-transfer': { src: transferPreview, thumbnail: transferThumb },
  'similar-pattern': { src: similarPreview, thumbnail: similarThumb },
  'pattern-fusion': { src: fusionPreview, thumbnail: fusionThumb },
  'bg-tone': { src: backgroundPreview, thumbnail: backgroundThumb },
  'fabric-recolor': {
    src: fabricRecolorPreview,
    thumbnail: fabricRecolorThumb,
  },
  'lineart-style': { src: lineartStylePreview, thumbnail: lineartStyleThumb },
  'lineart-extract': {
    src: lineartExtractPreview,
    thumbnail: lineartExtractThumb,
  },
}

interface FashionPresetPreviewProps {
  preset: FashionPreset
}

export function FashionPresetPreview(props: FashionPresetPreviewProps) {
  const preview = FASHION_PRESET_PREVIEWS[props.preset.value]
  if (!preview) {
    return <BoardGlyph kind={props.preset.glyph} />
  }
  return (
    <img
      src={preview.thumbnail}
      alt=''
      width={480}
      height={320}
      decoding='async'
      className='aspect-[3/2] w-full rounded-md object-cover'
    />
  )
}

interface FashionShowcaseProps {
  preset: FashionPreset | null
}

/** 有图片的模板展示对应图文案例，其余方向展示通用案例。 */
export function FashionShowcase(props: FashionShowcaseProps) {
  const { t } = useTranslation()
  const descriptions: Partial<Record<string, string>> = {
    'fabric-swap': t(
      'Replace the fabric while keeping the garment cut and details.'
    ),
    'pattern-swap': t(
      'Apply a new pattern while preserving the garment shape.'
    ),
    'garment-recolor': t(
      'Change the garment color while keeping its texture and shading.'
    ),
    'description-redesign': t(
      'Describe the neckline, sleeves or silhouette changes you want.'
    ),
    'reference-redesign': t(
      'Borrow design details from a reference while retaining the base garment.'
    ),
    'print-removal': t('Remove prints to reveal a clean, solid-color garment.'),
    'viral-split': t('Explore six variations of a best-selling garment.'),
    'viral-proposal': t(
      'Develop three garment proposals with material detail views.'
    ),
    'detail-style': t('Create new styles around distinctive garment details.'),
    'fabric-style': t('Turn a fabric swatch into six garment designs.'),
    'description-style': t(
      'Describe your design idea and optionally add a fabric swatch.'
    ),
    'series-variation': t(
      'Extend one garment into a coordinated series of six variations.'
    ),
    'series-fabric': t(
      'Create a jacket and dress collection from one fabric swatch.'
    ),
    'series-reference': t(
      'Use up to three reference images to develop a coordinated collection.'
    ),
    'pattern-extract': t('Extract a garment print into a clean, flat pattern.'),
    'four-way-repeat': t(
      'Turn a motif into a seamless four-way repeat pattern.'
    ),
    'style-transfer': t('Apply the craft style of a reference to your motif.'),
    'similar-pattern': t('Create six related variations from one pattern.'),
    'pattern-fusion': t('Blend two patterns into one harmonious design.'),
    'bg-tone': t(
      'Change the background color while keeping the motifs intact.'
    ),
    'fabric-recolor': t(
      'Recolor the fabric while preserving its texture, sheen and folds.'
    ),
    'lineart-style': t(
      'Dress a line art silhouette with your fabric into a finished garment.'
    ),
    'lineart-extract': t(
      'Extract a clean black-and-white technical line art from a garment.'
    ),
  }
  const preset = props.preset
  const preview = preset ? FASHION_PRESET_PREVIEWS[preset.value] : undefined
  const caption =
    preset && preview ? t(preset.label) : t('Fashion design examples')
  const description =
    (preset && descriptions[preset.value]) ||
    t('Upload materials and describe your idea to create fashion designs.')

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
      <figure className='border-border bg-card overflow-hidden rounded-xl border shadow-sm'>
        <img
          src={preview?.src ?? fashionPreview}
          alt={caption}
          width={1200}
          height={800}
          decoding='async'
          className='h-auto w-full'
        />
      </figure>
      <ShowcaseHint
        icon={Shirt}
        title={caption}
        description={description}
        badges={[
          t('Garment redesign'),
          t('New style creation'),
          t('Fabric design'),
        ]}
      />
    </section>
  )
}
