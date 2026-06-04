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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface CTAProps {
  className?: string
  isAuthenticated?: boolean
}

export function CTA(props: CTAProps) {
  const { t } = useTranslation()

  if (props.isAuthenticated) {
    return null
  }

  return (
    <section className='relative overflow-hidden bg-white px-6 py-24 dark:bg-transparent md:py-32'>
      {/* Large background glow orb */}
      <div
        className='pointer-events-none absolute inset-x-0 top-1/2 -z-10 mx-auto size-[700px] max-w-full -translate-y-1/2 rounded-full opacity-60'
        style={{
          background:
            'radial-gradient(circle, rgba(37,99,235,0.06) 0%, rgba(56,189,248,0.03) 35%, transparent 70%)',
        }}
      />
      <div className='relative mx-auto max-w-2xl text-center'>
        {/* Glowing top border */}
        <div className='mb-12 mx-auto h-px w-24'
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(37,99,235,0.5), rgba(56,189,248,0.5), rgba(37,99,235,0.5), transparent)',
          }}
        />
        <h2 className='text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 md:text-5xl'>
          {t('Ready to simplify')}
          <br />
          <span className='bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent'>
            {t('your AI integration?')}
          </span>
        </h2>
        <p className='mx-auto mt-6 max-w-md text-base leading-relaxed text-gray-500 dark:text-gray-400'>
          {t(
            'Deploy your own gateway and start routing requests through your configured upstream services.'
          )}
        </p>
        <div className='mt-10 flex items-center justify-center gap-3'>
          <Button
            className='relative h-12 rounded-xl bg-blue-600 px-8 text-base font-semibold text-white hover:bg-blue-700 shadow-[0_0_24px_rgba(37,99,235,0.25)] transition-all duration-300 hover:shadow-[0_0_32px_rgba(37,99,235,0.35)]'
            render={<Link to='/sign-up' />}
          >
            {t('Get Started')}
            <ArrowRight className='ml-1 size-4' />
          </Button>
          <Button
            variant='outline'
            className='h-12 rounded-xl border-2 border-gray-200 bg-white px-8 text-base font-semibold text-gray-900 hover:border-blue-200 hover:text-blue-600 dark:border-gray-700 dark:bg-transparent dark:text-gray-100 dark:hover:border-blue-800 dark:hover:text-blue-400'
            render={<Link to='/pricing' />}
          >
            {t('View Pricing')}
          </Button>
        </div>
      </div>
    </section>
  )
}
