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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface StatsProps {
  className?: string
}

function CountUp({ value, suffix }: { value: string; suffix: string }) {
  const [displayValue, setDisplayValue] = useState('0')
  const ref = useRef<HTMLSpanElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || hasAnimated.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          hasAnimated.current = true
          const target = parseFloat(value)
          const isDecimal = value.includes('.')
          const duration = 1500
          const start = performance.now()

          const step = (now: number) => {
            const progress = Math.min((now - start) / duration, 1)
            const eased = 1 - Math.pow(1 - progress, 3)
            const current = eased * target
            setDisplayValue(
              isDecimal ? current.toFixed(1) : Math.floor(current).toString()
            )
            if (progress < 1) requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [value])

  return (
    <span ref={ref} className='tabular-nums'>
      {displayValue}
      <span className='bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent'>
        {suffix}
      </span>
    </span>
  )
}

export function Stats(_props: StatsProps) {
  const { t } = useTranslation()

  const stats = [
    { value: '50', suffix: '+', label: t('Models') },
    { value: '10', suffix: '+', label: t('Providers') },
    { value: '99.9', suffix: '%', label: t('Uptime') },
    { value: '8', suffix: 'M+', label: t('Global Users') },
  ]

  return (
    <div className='relative border-b border-gray-100 bg-white dark:border-gray-800 dark:bg-transparent'>
      {/* Subtle top glow */}
      <div
        className='pointer-events-none absolute inset-x-0 top-0 h-px'
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(37,99,235,0.3), rgba(56,189,248,0.3), rgba(37,99,235,0.3), transparent)',
        }}
      />
      <div className='mx-auto max-w-4xl px-6 py-12 md:py-16'>
        <div className='grid grid-cols-2 gap-8 md:grid-cols-4 md:gap-12'>
          {stats.map((stat) => (
            <div
              key={stat.label}
              className='flex flex-col items-center text-center'
            >
              <span className='text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 md:text-5xl'>
                <CountUp value={stat.value} suffix={stat.suffix} />
              </span>
              <span className='mt-2 text-sm font-medium text-gray-400 dark:text-gray-500'>
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
