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
import { ArrowRight, Bot } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

const HexGrid = () => (
  <div
    className='pointer-events-none absolute inset-0 -z-10'
    style={{
      backgroundImage: `
        linear-gradient(30deg, rgba(37,99,235,0.03) 12%, transparent 12.5%, transparent 87%, rgba(37,99,235,0.03) 87.5%, rgba(37,99,235,0.03)),
        linear-gradient(150deg, rgba(37,99,235,0.03) 12%, transparent 12.5%, transparent 87%, rgba(37,99,235,0.03) 87.5%, rgba(37,99,235,0.03)),
        linear-gradient(30deg, rgba(37,99,235,0.03) 12%, transparent 12.5%, transparent 87%, rgba(37,99,235,0.03) 87.5%, rgba(37,99,235,0.03)),
        linear-gradient(150deg, rgba(37,99,235,0.03) 12%, transparent 12.5%, transparent 87%, rgba(37,99,235,0.03) 87.5%, rgba(37,99,235,0.03)),
        linear-gradient(60deg, rgba(56,189,248,0.02) 25%, transparent 25.5%, transparent 75%, rgba(56,189,248,0.02) 75%, rgba(56,189,248,0.02)),
        linear-gradient(60deg, rgba(56,189,248,0.02) 25%, transparent 25.5%, transparent 75%, rgba(56,189,248,0.02) 75%, rgba(56,189,248,0.02))
      `,
      backgroundSize: '80px 140px',
      backgroundPosition: '0 0, 0 0, 40px 70px, 40px 70px, 0 0, 40px 70px',
    }}
  />
)

const Scanlines = () => (
  <div
    className='pointer-events-none absolute inset-0 -z-10 opacity-[0.015]'
    style={{
      backgroundImage:
        'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(37,99,235,0.5) 2px, rgba(37,99,235,0.5) 3px)',
    }}
  />
)

const GlowOrbs = () => (
  <>
    {/* Top-center blue glow */}
    <div
      className='pointer-events-none absolute -top-64 left-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 animate-pulse rounded-full'
      style={{
        background:
          'radial-gradient(circle, rgba(37,99,235,0.08) 0%, rgba(37,99,235,0.02) 40%, transparent 70%)',
        animationDuration: '8s',
      }}
    />
    {/* Right side cyan glow */}
    <div
      className='pointer-events-none absolute top-0 right-0 -z-10 h-[500px] w-[500px] translate-x-1/3 -translate-y-1/3 animate-pulse rounded-full'
      style={{
        background:
          'radial-gradient(circle, rgba(56,189,248,0.06) 0%, rgba(56,189,248,0.01) 50%, transparent 70%)',
        animationDuration: '12s',
        animationDelay: '2s',
      }}
    />
    {/* Bottom-left subtle glow */}
    <div
      className='pointer-events-none absolute bottom-0 left-0 -z-10 h-[400px] w-[400px] -translate-x-1/4 translate-y-1/4 animate-pulse rounded-full'
      style={{
        background:
          'radial-gradient(circle, rgba(37,99,235,0.04) 0%, transparent 70%)',
        animationDuration: '10s',
        animationDelay: '4s',
      }}
    />
  </>
)

export function Hero(props: HeroProps) {
  const { t } = useTranslation()

  return (
    <section className='relative z-10 overflow-hidden bg-white px-6 pt-24 pb-16 dark:bg-transparent md:pt-32 md:pb-24'>
      <HexGrid />
      <Scanlines />
      <GlowOrbs />
      <div className='mx-auto max-w-4xl text-center'>
        {/* Main Title */}
        <h1 className='text-[clamp(2.75rem,6vw,4.5rem)] leading-[1.05] font-extrabold tracking-tight text-gray-900 dark:text-gray-100'>
          {t('The Unified Interface')}
          <br />
          <span className='bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent'>
            {t('For LLMs')}
          </span>
        </h1>

        {/* Subtitle */}
        <p className='mt-6 text-lg leading-relaxed text-gray-500 dark:text-gray-400 md:text-xl'>
          <Trans
            i18nKey='Better <highlight>prices</highlight>, better <highlight>uptime</highlight>, no subscriptions.'
            components={{ highlight: <span className='font-semibold text-gray-900 dark:text-gray-100' /> }}
          />
        </p>

        {/* CTA Buttons */}
        <div className='mt-10 flex flex-wrap items-center justify-center gap-3'>
          {props.isAuthenticated ? (
            <>
              <Button
                className='relative h-12 rounded-xl bg-blue-600 px-8 text-base font-semibold text-white hover:bg-blue-700 shadow-[0_0_24px_rgba(37,99,235,0.25)] transition-all duration-300 hover:shadow-[0_0_32px_rgba(37,99,235,0.35)]'
                render={<Link to='/dashboard' />}
              >
                {t('Go to Dashboard')}
                <ArrowRight className='ml-1.5 size-4' />
              </Button>
              <Button
                variant='outline'
                className='h-12 rounded-xl border-2 border-gray-200 bg-white px-8 text-base font-semibold text-gray-900 hover:border-blue-200 hover:bg-blue-50/50 dark:border-gray-700 dark:bg-transparent dark:text-gray-100 dark:hover:border-blue-800 dark:hover:bg-blue-950/30'
                render={<Link to='/pricing' />}
              >
                <Bot className='mr-1.5 size-4' />
                {t('Model Square')}
              </Button>
            </>
          ) : (
            <>
              <Button
                className='relative h-12 rounded-xl bg-blue-600 px-8 text-base font-semibold text-white hover:bg-blue-700 shadow-[0_0_24px_rgba(37,99,235,0.25)] transition-all duration-300 hover:shadow-[0_0_32px_rgba(37,99,235,0.35)]'
                render={<Link to='/sign-up' />}
              >
                {t('Get API Key')}
                <ArrowRight className='ml-1.5 size-4' />
              </Button>
              <Button
                variant='outline'
                className='h-12 rounded-xl border-2 border-gray-200 bg-white px-8 text-base font-semibold text-gray-900 hover:border-blue-200 hover:bg-blue-50/50 dark:border-gray-700 dark:bg-transparent dark:text-gray-100 dark:hover:border-blue-800 dark:hover:bg-blue-950/30'
                render={<Link to='/pricing' />}
              >
                <Bot className='mr-1.5 size-4' />
                {t('Model Square')}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
