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
import { LayoutList } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import detailPreview from '@/assets/hero/detail-page-preview.webp'

import { ShowcaseHint } from './showcase-hint'

/** 详情页的静态案例，与用户生成的图片分开呈现。 */
export function DetailShowcase() {
  const { t } = useTranslation()

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
          src={detailPreview}
          alt={t('Product detail page examples')}
          width={1280}
          height={853}
          decoding='async'
          className='border-border max-h-full w-auto max-w-full rounded-xl border shadow-sm'
        />
      </figure>
      <ShowcaseHint
        icon={LayoutList}
        title={t('Product detail page examples')}
        description={t(
          'Choose modules to generate one image each, in order, with a shared visual style. Download the images to assemble a long detail page.'
        )}
        badges={[
          t('Selling point overview'),
          t('Use scenes'),
          t('Local close-up'),
          t('Brand ending'),
        ]}
      />
    </section>
  )
}
