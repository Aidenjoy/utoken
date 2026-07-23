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
  Cpu,
  Database,
  BrainCircuit,
  PackageSearch,
  BarChart3,
  Users,
  Bot,
  Wrench,
  Code2,
  Workflow,
  Lightbulb,
  Truck,
  LifeBuoy,
  ClipboardList,
  PencilRuler,
  FlaskConical,
  Rocket,
  Headset,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface YouYaoSolutionProps {
  className?: string
}

export function YouYaoSolution(_props: YouYaoSolutionProps) {
  const { t } = useTranslation()

  const marketStats = [
    { value: '70', suffix: t('10K+'), label: t('Total Pharmacies Nationwide') },
    { value: '2', suffix: '%', label: t('24/7 Operational') },
    { value: '487', suffix: t('B Yuan'), label: t('Market Gap') },
    { value: '98', suffix: '%', label: t('Nighttime Demand Unmet') },
  ]

  const advantages = [
    {
      id: 'hardware-data',
      icon: <Cpu className='size-5' />,
      title: t('Hardware Perception Data'),
      desc: t(
        'Temperature, humidity, and light sensors monitor environment in real-time. Robot vision system identifies user behavior patterns.'
      ),
    },
    {
      id: 'erp-data',
      icon: <Database className='size-5' />,
      title: t('ERP Deep Data'),
      desc: t(
        'Mastering pricing, margins, and commercial data from thousands of pharmacies. Integrated with Meituan, Ele.me, and JD O2O platforms.'
      ),
    },
    {
      id: 'ai-engine',
      icon: <BrainCircuit className='size-5' />,
      title: t('AI Fusion Engine'),
      desc: t(
        'Response 72 hours faster than competitors. Weather-driven marketing: 3°C drop predicts 40% cold medicine surge. Conversion up 8x, ROI up 5x.'
      ),
    },
  ]

  const modules = [
    {
      id: 'ai-inventory',
      icon: <PackageSearch className='size-5' />,
      title: t('AI Inventory Management'),
      desc: t(
        'Dual-camera stereo vision with 99.2% accuracy. Industry-first 3-level expiry warning system for pharmaceuticals.'
      ),
    },
    {
      id: 'data-decisions',
      icon: <BarChart3 className='size-5' />,
      title: t('Data-Driven Decisions'),
      desc: t(
        'Smart business cockpit generates real-time visual dashboards. Inventory turnover rate improved by 75%.'
      ),
    },
    {
      id: 'smart-service',
      icon: <Users className='size-5' />,
      title: t('Smart User Services'),
      desc: t(
        'Three-terminal seamless purchasing experience. 24h self-service covers 95% of nighttime medicine needs.'
      ),
    },
  ]

  const resultStats = [
    { value: '40', suffix: '%+', label: t('Sales Growth') },
    { value: '64', suffix: t('x'), label: t('Floor Efficiency Multiplier') },
    { value: '95', suffix: '%', label: t('Nighttime Coverage') },
    { value: '30', suffix: '%', label: t('Labor Cost Savings') },
  ]

  const services = [
    {
      id: 'hardware',
      icon: <Wrench className='size-5' />,
      title: t('Hardware Customization'),
      desc: t(
        'Custom smart medicine cabinet design, robotics engineering, and IoT hardware development tailored to your specifications.'
      ),
    },
    {
      id: 'software',
      icon: <Code2 className='size-5' />,
      title: t('Software System Development'),
      desc: t(
        'AI algorithms, ERP systems, management platforms, and mobile applications built from the ground up.'
      ),
    },
    {
      id: 'integration',
      icon: <Workflow className='size-5' />,
      title: t('System Integration'),
      desc: t(
        'Seamless integration with O2O platforms, payment gateways, logistics systems, and regulatory compliance frameworks.'
      ),
    },
    {
      id: 'consulting',
      icon: <Lightbulb className='size-5' />,
      title: t('Operations Consulting'),
      desc: t(
        'Business model design, marketing strategy, data-driven operations, and growth consulting from industry experts.'
      ),
    },
    {
      id: 'supply-chain',
      icon: <Truck className='size-5' />,
      title: t('Supply Chain Solutions'),
      desc: t(
        'Drug procurement networks, cold chain logistics, and inventory optimization strategies for maximum efficiency.'
      ),
    },
    {
      id: 'support',
      icon: <LifeBuoy className='size-5' />,
      title: t('Maintenance & Support'),
      desc: t(
        '7×24 monitoring, preventive maintenance, system upgrades, and comprehensive staff training programs.'
      ),
    },
  ]

  const processSteps = [
    {
      id: 'step-1',
      icon: <ClipboardList className='size-4' />,
      title: t('Requirements Analysis'),
      desc: t(
        'In-depth needs assessment, feasibility study, and project scope definition.'
      ),
    },
    {
      id: 'step-2',
      icon: <PencilRuler className='size-4' />,
      title: t('Solution Design'),
      desc: t(
        'Custom architecture design, technology selection, and detailed implementation roadmap.'
      ),
    },
    {
      id: 'step-3',
      icon: <FlaskConical className='size-4' />,
      title: t('Development & Testing'),
      desc: t(
        'Agile development, rigorous quality assurance, and integration testing across all components.'
      ),
    },
    {
      id: 'step-4',
      icon: <Rocket className='size-4' />,
      title: t('Deployment & Delivery'),
      desc: t(
        'On-site installation, system configuration, staff training, and seamless go-live support.'
      ),
    },
    {
      id: 'step-5',
      icon: <Headset className='size-4' />,
      title: t('Ongoing Support'),
      desc: t(
        'Continuous monitoring, performance optimization, and regular system upgrades.'
      ),
    },
  ]

  return (
    <section className='relative overflow-hidden bg-gray-50 dark:bg-transparent'>
      {/* Background decorative gradient */}
      <div
        className='pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-96 max-w-3xl rounded-full opacity-40'
        style={{
          background:
            'radial-gradient(circle, rgba(37,99,235,0.05) 0%, rgba(56,189,248,0.03) 40%, transparent 70%)',
        }}
      />

      <div className='mx-auto max-w-6xl px-6 py-20 md:py-28'>
        {/* === Section Header === */}
        <div className='mx-auto max-w-2xl text-center'>
          <p className='mb-3 text-xs font-semibold tracking-widest text-blue-600 uppercase dark:text-blue-400'>
            {t('Smart Pharmacy Solution')}
          </p>
          <h2 className='text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 md:text-4xl'>
            {t('Pharmaceutical AI Smart Marketing System')}
          </h2>
          <p className='mt-3 text-lg font-semibold bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent'>
            {t('24h Unmanned Cabinet × AI Operations × Full-Process Digitalization')}
          </p>
          <p className='mx-auto mt-6 max-w-xl text-base leading-relaxed text-gray-500 dark:text-gray-400'>
            {t(
              'Founded in 2019, the first enterprise to deeply integrate AI, smart hardware, and IoT in pharmaceutical retail. Delivering 24-hour unmanned smart medicine cabinets and AI-powered intelligent operations.'
            )}
          </p>
        </div>

        {/* === Market Pain Points === */}
        <div className='mt-16'>
          <h3 className='mb-6 text-center text-sm font-semibold tracking-widest text-gray-400 uppercase'>
            {t('Market Pain Points')}
          </h3>
          <div className='grid grid-cols-2 gap-4 rounded-2xl border border-gray-100 bg-white p-6 dark:border-gray-800 dark:bg-transparent md:grid-cols-4 md:gap-6 md:p-8'>
            {marketStats.map((stat) => (
              <div key={stat.label} className='flex flex-col items-center text-center'>
                <span className='text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 md:text-4xl'>
                  {stat.value}
                  <span className='bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent'>
                    {stat.suffix}
                  </span>
                </span>
                <span className='mt-2 text-xs font-medium text-gray-400 dark:text-gray-500'>
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* === Core Advantages === */}
        <div className='mt-16'>
          <h3 className='mb-6 text-center text-sm font-semibold tracking-widest text-gray-400 uppercase'>
            {t('Core Advantages')}
          </h3>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {advantages.map((a) => (
              <div
                key={a.id}
                className='group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 transition-all duration-300 hover:border-blue-200 hover:shadow-[0_4px_24px_-6px_rgba(37,99,235,0.1)] hover:-translate-y-1 dark:border-gray-800 dark:bg-transparent dark:hover:border-blue-800'
              >
                <div
                  className='pointer-events-none absolute -top-20 -right-20 size-40 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100'
                  style={{
                    background:
                      'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 70%)',
                  }}
                />
                <div className='relative mb-4 inline-flex'>
                  <div className='absolute -inset-1 rounded-xl bg-gradient-to-br from-blue-500/15 to-sky-500/15 blur-sm' />
                  <div className='relative flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors duration-300 group-hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:group-hover:bg-blue-900/50'>
                    {a.icon}
                  </div>
                </div>
                <h4 className='mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100'>
                  {a.title}
                </h4>
                <p className='text-sm leading-relaxed text-gray-500 dark:text-gray-400'>
                  {a.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* === Core Function Modules === */}
        <div className='mt-16'>
          <h3 className='mb-6 text-center text-sm font-semibold tracking-widest text-gray-400 uppercase'>
            {t('Core Function Modules')}
          </h3>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {modules.map((m) => (
              <div
                key={m.id}
                className='group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 transition-all duration-300 hover:border-blue-200 hover:shadow-[0_4px_24px_-6px_rgba(37,99,235,0.1)] hover:-translate-y-1 dark:border-gray-800 dark:bg-transparent dark:hover:border-blue-800'
              >
                <div
                  className='pointer-events-none absolute -top-20 -right-20 size-40 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100'
                  style={{
                    background:
                      'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 70%)',
                  }}
                />
                <div className='relative mb-4 inline-flex'>
                  <div className='absolute -inset-1 rounded-xl bg-gradient-to-br from-blue-500/15 to-sky-500/15 blur-sm' />
                  <div className='relative flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors duration-300 group-hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:group-hover:bg-blue-900/50'>
                    {m.icon}
                  </div>
                </div>
                <h4 className='mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100'>
                  {m.title}
                </h4>
                <p className='text-sm leading-relaxed text-gray-500 dark:text-gray-400'>
                  {m.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* === Compound Robot Highlight === */}
        <div className='mt-16 overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-sky-50 p-8 dark:border-blue-900 dark:from-blue-950 dark:to-sky-950 md:p-10'>
          <div className='flex flex-col items-start gap-6 md:flex-row md:items-center md:gap-10'>
            <div className='flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-sky-400 text-white shadow-lg'>
              <Bot className='size-8' />
            </div>
            <div className='flex-1'>
              <h3 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
                {t('Compound Robot')}
              </h3>
              <p className='mt-1 text-sm font-medium text-blue-600 dark:text-blue-400'>
                {t('From fixed cabinet to full store coverage — a historic breakthrough.')}
              </p>
              <p className='mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300'>
                {t(
                  'Traditional smart cabinets hold 180 medicines; our compound robot supports 3000+. Operates in zero-light environments for true 24h unmanned operation. Completes order-to-pickup in 2 minutes. Saves 200K yuan annually, boosts nighttime sales 5x.'
                )}
              </p>
            </div>
          </div>
        </div>

        {/* === Business Results === */}
        <div className='mt-16'>
          <h3 className='mb-6 text-center text-sm font-semibold tracking-widest text-gray-400 uppercase'>
            {t('Business Results')}
          </h3>
          <div className='grid grid-cols-2 gap-4 rounded-2xl border border-gray-100 bg-white p-6 dark:border-gray-800 dark:bg-transparent md:grid-cols-4 md:gap-6 md:p-8'>
            {resultStats.map((stat) => (
              <div key={stat.label} className='flex flex-col items-center text-center'>
                <span className='text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 md:text-4xl'>
                  {stat.value}
                  <span className='bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent'>
                    {stat.suffix}
                  </span>
                </span>
                <span className='mt-2 text-xs font-medium text-gray-400 dark:text-gray-500'>
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* === Global Customized Service === */}
        <div className='mt-20 border-t border-gray-100 pt-16 dark:border-gray-800'>
          {/* Service Header */}
          <div className='mx-auto max-w-2xl text-center'>
            <p className='mb-3 text-xs font-semibold tracking-widest text-blue-600 uppercase dark:text-blue-400'>
              {t('Global Customized Service')}
            </p>
            <h3 className='text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 md:text-3xl'>
              {t('Global Customization Services')}
            </h3>
            <p className='mx-auto mt-4 max-w-xl text-base leading-relaxed text-gray-500 dark:text-gray-400'>
              {t(
                'Full-cycle customization for global pharmaceutical retail — from hardware design to AI operations, we deliver end-to-end tailored solutions.'
              )}
            </p>
          </div>

          {/* Service Categories */}
          <div className='mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {services.map((s) => (
              <div
                key={s.id}
                className='group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 transition-all duration-300 hover:border-blue-200 hover:shadow-[0_4px_24px_-6px_rgba(37,99,235,0.1)] hover:-translate-y-1 dark:border-gray-800 dark:bg-transparent dark:hover:border-blue-800'
              >
                <div
                  className='pointer-events-none absolute -top-20 -right-20 size-40 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100'
                  style={{
                    background:
                      'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 70%)',
                  }}
                />
                <div className='relative mb-4 inline-flex'>
                  <div className='absolute -inset-1 rounded-xl bg-gradient-to-br from-blue-500/15 to-sky-500/15 blur-sm' />
                  <div className='relative flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors duration-300 group-hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:group-hover:bg-blue-900/50'>
                    {s.icon}
                  </div>
                </div>
                <h4 className='mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100'>
                  {s.title}
                </h4>
                <p className='text-sm leading-relaxed text-gray-500 dark:text-gray-400'>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Service Process */}
          <div className='mt-12'>
            <h4 className='mb-6 text-center text-sm font-semibold tracking-widest text-gray-400 uppercase'>
              {t('Service Process')}
            </h4>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
              {processSteps.map((step, index) => (
                <div
                  key={step.id}
                  className='relative rounded-2xl border border-gray-100 bg-white p-5 dark:border-gray-800 dark:bg-transparent'
                >
                  <div className='mb-3 flex items-center gap-2.5'>
                    <div className='flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-sky-400 text-xs font-bold text-white shadow-sm'>
                      {index + 1}
                    </div>
                    <div className='text-blue-600 dark:text-blue-400'>{step.icon}</div>
                  </div>
                  <h5 className='mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                    {step.title}
                  </h5>
                  <p className='text-xs leading-relaxed text-gray-500 dark:text-gray-400'>
                    {step.desc}
                  </p>
                  {/* Arrow connector (desktop) */}
                  {index < processSteps.length - 1 && (
                    <div className='absolute -right-3 top-7 hidden lg:block text-gray-200 dark:text-gray-700'>
                      <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                        <path d='M5 12h14M13 6l6 6-6 6' />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>


        </div>
      </div>
    </section>
  )
}
