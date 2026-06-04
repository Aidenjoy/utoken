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
import { Link } from '@tanstack/react-router'
import { ArrowRight, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface ModelCardProps {
  provider: string
  model: string
  context: string
  price: string
  isNew?: boolean
  isHot?: boolean
}

function ModelCard(props: ModelCardProps) {
  return (
    <div className='group relative cursor-pointer overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 transition-all duration-300 hover:border-blue-200 hover:shadow-[0_8px_40px_-8px_rgba(37,99,235,0.12)] hover:-translate-y-0.5 dark:border-gray-800 dark:bg-transparent dark:hover:border-blue-800 dark:hover:shadow-[0_8px_40px_-8px_rgba(37,99,235,0.08)]'>
      {/* Left accent line */}
      <div className='absolute inset-y-0 left-0 w-0.5 rounded-r-full bg-gradient-to-b from-blue-500 via-blue-600 to-sky-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
      <div className='mb-3 flex items-center gap-2'>
        <div className='relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-gray-900 text-xs font-bold text-white'>
          {/* Subtle inner glow */}
          <div
            className='absolute inset-0 opacity-30'
            style={{
              background:
                'radial-gradient(circle at 30% 30%, rgba(56,189,248,0.6), transparent)',
            }}
          />
          <span className='relative'>{props.provider.charAt(0).toUpperCase()}</span>
        </div>
        <div>
          <div className='flex items-center gap-1.5'>
            <span className='text-xs font-medium text-gray-400 dark:text-gray-500'>
              {props.provider}
            </span>
            {props.isNew && (
              <span className='rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'>
                NEW
              </span>
            )}
            {props.isHot && (
              <span className='rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600'>
                HOT
              </span>
            )}
          </div>
          <span className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
            {props.model}
          </span>
        </div>
      </div>
      <div className='flex items-center justify-between text-xs text-gray-400 dark:text-gray-500'>
        <span className='inline-flex items-center gap-1'>
          <span className='inline-block size-1 rounded-full bg-blue-400' />
          {props.context}
        </span>
        <span className='font-mono font-medium tracking-tight text-gray-600 dark:text-gray-400'>
          {props.price}
        </span>
      </div>
    </div>
  )
}

const MODELS: ModelCardProps[] = [
  {
    provider: 'DeepSeek',
    model: 'DeepSeek-V4-Pro',
    context: '1M context',
    price: '¥3/¥6',
    isHot: true,
  },
  {
    provider: '字节跳动',
    model: 'Doubao-Seed2.0-Pro',
    context: '128K context',
    price: '¥3.2/¥16',
    isHot: true,
  },
  {
    provider: '阿里云',
    model: 'Qwen3.7-Max',
    context: '1M context',
    price: '¥12/¥36',
    isNew: true,
  },
  {
    provider: '智谱AI',
    model: 'GLM-5.1',
    context: '128K context',
    price: '¥6/¥30',
    isNew: true,
  },
  {
    provider: '月之暗面',
    model: 'Kimi-K2.6',
    context: '256K context',
    price: '¥6.5/¥27',
    isHot: true,
  },
  {
    provider: 'MiniMax',
    model: 'MiniMax-M3',
    context: '1M context',
    price: '¥4/¥17',
    isNew: true,
  },
]

export function ModelShowcase() {
  const { t } = useTranslation()

  return (
    <section className='bg-white px-6 py-20 dark:bg-transparent md:py-28'>
      <div className='mx-auto max-w-6xl'>
        {/* Header */}
        <div className='mb-10 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end'>
          <div>
            <div className='mb-2 inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'>
              <Sparkles className='size-3' />
              <span>{t('400+ models available')}</span>
            </div>
            <h2 className='text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 md:text-3xl'>
              {t('Browse the latest')}
              <br />
              <span className='bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent'>{t('Available models')}</span>
            </h2>
          </div>
          <div className='flex items-center gap-3'>
            <Button
              variant='outline'
              className='h-10 rounded-xl border-2 border-gray-200 bg-white px-5 text-sm font-semibold text-gray-900 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-100 dark:hover:border-gray-600 dark:hover:bg-gray-800'
              render={<Link to='/pricing' />}
            >
              {t('View all')}
              <ArrowRight className='ml-1 size-3.5' />
            </Button>
          </div>
        </div>

        {/* Model Grid */}
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {MODELS.map((m) => (
            <ModelCard key={`${m.provider}/${m.model}`} {...m} />
          ))}
        </div>
      </div>
    </section>
  )
}
