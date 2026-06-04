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
import { Key, Route, BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function HowItWorks() {
  const { t } = useTranslation()

  const steps = [
    {
      num: '1',
      title: t('Add your API keys'),
      desc: t(
        'Connect your provider API keys for OpenAI, Claude, Gemini, and more. We never store your keys in plain text.'
      ),
      icon: <Key className='size-6' />,
    },
    {
      num: '2',
      title: t('Route your requests'),
      desc: t(
        'Configure routing rules, rate limits, and load balancing. One endpoint works with all OpenAI-compatible SDKs.'
      ),
      icon: <Route className='size-6' />,
    },
    {
      num: '3',
      title: t('Monitor and scale'),
      desc: t(
        'Track usage, costs, and performance in real-time. Add more providers and scale without changing a line of code.'
      ),
      icon: <BarChart3 className='size-6' />,
    },
  ]

  return (
    <section className='bg-gray-50 px-6 py-20 dark:bg-transparent md:py-28'>
      <div className='mx-auto max-w-6xl'>
        <div className='mb-14 text-center'>
          <p className='mb-3 text-xs font-semibold tracking-widest text-blue-600 dark:text-blue-400 uppercase'>
            {t('How It Works')}
          </p>
          <h2 className='text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 md:text-3xl'>
            {t('Start in minutes')}
          </h2>
        </div>

        <div className='relative grid gap-8 md:grid-cols-3 md:gap-12'>
          {/* Desktop connecting lines */}
          <svg
            className='pointer-events-none absolute inset-x-0 top-8 hidden select-none md:block'
            width='100%'
            height='2'
            viewBox='0 0 100 2'
            preserveAspectRatio='none'
          >
            <line
              x1='0'
              y1='1'
              x2='100'
              y2='1'
              stroke='url(#lineGradient)'
              strokeWidth='2'
              strokeLinecap='round'
              strokeDasharray='3 8'
            />
            <defs>
              <linearGradient id='lineGradient' x1='0' y1='0' x2='1' y2='0'>
                <stop offset='0%' stopColor='rgba(37,99,235,0.1)' />
                <stop offset='30%' stopColor='rgba(37,99,235,0.35)' />
                <stop offset='70%' stopColor='rgba(56,189,248,0.35)' />
                <stop offset='100%' stopColor='rgba(56,189,248,0.1)' />
              </linearGradient>
            </defs>
          </svg>

          {/* Mobile connecting pulse dots */}
          <div className='absolute inset-x-0 top-8 flex items-center justify-center md:hidden'>
            <div className='flex items-center gap-2'>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className='size-1 rounded-full bg-blue-400 animate-pulse'
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
          {steps.map((step) => (
            <div
              key={step.num}
              className='relative flex flex-col items-center text-center'
            >
              <div className='relative mb-6'>
                {/* Icon glow ring */}
                <div className='absolute -inset-1 rounded-2xl bg-gradient-to-br from-blue-500/15 to-sky-500/15 blur-sm opacity-0 transition-opacity duration-500 group-hover:opacity-100' />
                <div className='relative flex size-16 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm ring-1 ring-gray-100 transition-all duration-300 group-hover:shadow-md group-hover:ring-blue-200 dark:bg-transparent dark:text-blue-400 dark:ring-gray-800 dark:group-hover:ring-blue-800'>
                  {step.icon}
                </div>
                <div className='absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-sm ring-2 ring-white dark:ring-gray-900'>
                  {step.num}
                </div>
              </div>
              <h3 className='mb-2 text-base font-semibold text-gray-900 dark:text-gray-100'>
                {step.title}
              </h3>
              <p className='max-w-xs text-sm leading-relaxed text-gray-500 dark:text-gray-400'>
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
