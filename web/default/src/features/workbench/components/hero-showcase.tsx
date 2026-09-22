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
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import heroPreview from '@/assets/hero/hero-preview.webp'

import { ShowcaseHint } from './showcase-hint'

/** 主图设计的静态商品示例，与实际生成结果明确区分。 */
export function HeroShowcase() {
  const { t } = useTranslation()

  return (
    <div className='dark:bg-muted/30 border-border flex min-h-[420px] min-w-0 flex-1 flex-col justify-center gap-5 overflow-hidden rounded-xl border bg-[#edf3f0] p-6'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{t('Generated result')}</span>
        <span className='text-muted-foreground text-xs'>
          {t('Example preview')}
        </span>
      </div>
      <figure className='border-border bg-card overflow-hidden rounded-xl border shadow-sm'>
        <img
          src={heroPreview}
          alt={t('Product hero image examples')}
          width={1280}
          height={731}
          decoding='async'
          className='h-auto w-full'
        />
      </figure>
      <ShowcaseHint
        icon={Sparkles}
        title={t('Product hero image examples')}
        description={t(
          'Upload product images and choose content elements to create your hero image.'
        )}
        badges={[
          t('Main title'),
          t('Core selling points'),
          t('Use scenes'),
          t('With model'),
        ]}
      />
    </div>
  )
}
