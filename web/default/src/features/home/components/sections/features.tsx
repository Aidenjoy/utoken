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
import {
  Route,
  Shield,
  BarChart3,
  Zap,
  Globe,
  ArrowRightLeft,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface FeaturesProps {
  className?: string
}

export function Features(_props: FeaturesProps) {
  const { t } = useTranslation()

  const features = [
    {
      id: 'unified-access',
      icon: <Route className='size-5' />,
      title: t('Unified API'),
      desc: t(
        'One API for OpenAI, Claude, Gemini, DeepSeek and 400+ models. No SDK changes needed.'
      ),
    },
    {
      id: 'auto-failover',
      icon: <ArrowRightLeft className='size-5' />,
      title: t('Auto Failover'),
      desc: t(
        'Automatic provider failover and load balancing. Route to the best model for every request.'
      ),
    },
    {
      id: 'cost-tracking',
      icon: <BarChart3 className='size-5' />,
      title: t('Cost Tracking'),
      desc: t(
        'Real-time cost and token usage monitoring with detailed logs.'
      ),
    },
    {
      id: 'privacy',
      icon: <Shield className='size-5' />,
      title: t('Privacy First'),
      desc: t(
        'Self-host on your own infrastructure. Zero data logging by default.'
      ),
    },
    {
      id: 'global',
      icon: <Globe className='size-5' />,
      title: t('Global CDN'),
      desc: t(
        'Multi-region deployment with built-in CDN for low-latency access worldwide.'
      ),
    },
    {
      id: 'fast',
      icon: <Zap className='size-5' />,
      title: t('Lightning Fast'),
      desc: t(
        'Optimized routing engine with sub-50ms overhead. Built for scale.'
      ),
    },
  ]

  return (
    <section className='bg-gray-50 px-6 py-20 dark:bg-transparent md:py-28'>
      <div className='mx-auto max-w-6xl'>
        <div className='mb-14 max-w-lg'>
          <p className='mb-3 text-xs font-semibold tracking-widest text-blue-600 dark:text-blue-400 uppercase'>
            {t('Why choose us')}
          </p>
          <h2 className='text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 md:text-3xl'>
            {t('Everything you need')}
            <br />
            <span className='text-gray-400 dark:text-gray-500'>
              {t('to scale your AI')}
            </span>
          </h2>
        </div>

        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {features.map((f) => (
            <div
              key={f.id}
              className='group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 transition-all duration-300 hover:border-blue-200 hover:shadow-[0_4px_24px_-6px_rgba(37,99,235,0.1)] hover:-translate-y-1 dark:border-gray-800 dark:bg-transparent dark:hover:border-blue-800'
            >
              {/* Subtle corner glow on hover */}
              <div
                className='pointer-events-none absolute -top-20 -right-20 size-40 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100'
                style={{
                  background:
                    'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 70%)',
                }}
              />
              <div className='relative mb-4 inline-flex'>
                {/* Icon glow ring */}
                <div className='absolute -inset-1 rounded-xl bg-gradient-to-br from-blue-500/15 to-sky-500/15 blur-sm transition-opacity duration-300 group-hover:opacity-100' />
                <div className='relative flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors duration-300 group-hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:group-hover:bg-blue-900/50'>
                  {f.icon}
                </div>
              </div>
              <h3 className='mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100'>
                {f.title}
              </h3>
              <p className='text-sm leading-relaxed text-gray-500 dark:text-gray-400'>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
