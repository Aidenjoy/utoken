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
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import flatPreview from '@/assets/hero/closeup-flat-preview.webp'
import positionPreview from '@/assets/hero/closeup-position-preview.webp'
import threeDPreview from '@/assets/hero/closeup-threed-preview.webp'

import type { CloseUpShotMode } from '../types'
import { ShowcaseHint } from './showcase-hint'

interface CloseUpShowcaseProps {
  mode: CloseUpShotMode
}

/** 三种细节图模式的静态案例，仅在尚未生成时展示。 */
export function CloseUpShowcase(props: CloseUpShowcaseProps) {
  const { t } = useTranslation()
  const examples = {
    position: {
      image: positionPreview,
      caption: t('Garment detail examples'),
      description: t(
        'Upload garment images and select parts to highlight the collar, cuffs and fabric texture.'
      ),
    },
    flat: {
      image: flatPreview,
      caption: t('Flat-lay garment example'),
      description: t(
        'Upload a front view to create a full flat-lay base image, then use it for detail images.'
      ),
    },
    threed: {
      image: threeDPreview,
      caption: t('3D garment example'),
      description: t(
        'Upload a front view to create a dimensional garment base image, then use it for detail images.'
      ),
    },
  }
  const example = examples[props.mode]

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
          src={example.image}
          alt={example.caption}
          width={1200}
          height={800}
          decoding='async'
          className='h-auto w-full'
        />
      </figure>
      <ShowcaseHint
        icon={Search}
        title={example.caption}
        description={example.description}
        badges={[t('Neck / collar'), t('Cuff'), t('Fabric texture')]}
      />
    </section>
  )
}
