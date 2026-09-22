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
import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import duoResult from '@/assets/tryon/duo-result.webp'
import duoSources from '@/assets/tryon/duo-sources.webp'

import { ShowcaseHint } from './showcase-hint'

/**
 * Idle-state showcase for the duo try-on page: illustrates the two-model
 * pairing workflow with example images so the user understands the output
 * before uploading.
 */
export function DuoShowcase() {
  const { t } = useTranslation()

  return (
    <div className='dark:bg-muted/30 border-border relative flex min-h-[420px] flex-1 flex-col items-center justify-center overflow-hidden rounded-xl border bg-[#edf3f0] p-6'>
      <div className='flex flex-wrap items-center justify-center gap-4 sm:gap-6'>
        <div className='relative'>
          <img
            src={duoSources}
            alt=''
            className='border-card bg-muted h-48 w-64 rounded-xl border-4 object-cover shadow-md'
          />
          <span className='absolute -top-3 -left-2 -rotate-3 rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300'>
            {t('Upload examples')}
          </span>
        </div>

        <svg
          viewBox='0 0 24 24'
          aria-hidden='true'
          className='size-9 shrink-0 fill-current text-violet-500 drop-shadow-sm'
        >
          <path d='M7 4v16l13-8z' />
        </svg>

        <div className='bg-card relative rotate-2 rounded-2xl p-2 shadow-xl ring-2 ring-violet-400/70 transition-transform duration-300 hover:rotate-0'>
          <img
            src={duoResult}
            alt=''
            className='h-44 w-32 rounded-xl object-cover'
          />
          <span className='absolute -top-3 -right-2 rotate-2 rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300'>
            {t('Generated result')}
          </span>
        </div>
      </div>

      <ShowcaseHint
        className='mt-6'
        icon={Users}
        title={t('Duo Try-On')}
        description={t(
          'Upload matching garments, pick two models, then generate a paired commercial shot.'
        )}
        badges={[t('Garment'), t('Model'), t('Scene')]}
      />
    </div>
  )
}
