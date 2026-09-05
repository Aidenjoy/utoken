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
  Clapperboard,
  Globe,
  Image as ImageIcon,
  KeyRound,
  MessageSquareText,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import {
  getDocSections,
  getGettingStarted,
  resolveDocsSiteUrl,
  type DocsTabId,
} from './content'

const TABS: { id: DocsTabId; label: string; icon: LucideIcon }[] = [
  { id: 'language', label: '语言模型', icon: MessageSquareText },
  { id: 'image', label: '图片模型', icon: ImageIcon },
  { id: 'video', label: '视频模型', icon: Clapperboard },
]

const TAB_ACTIVE_STYLES: Record<DocsTabId, string> = {
  language:
    'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  image:
    'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  video: 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

function GettingStartedCard(props: {
  icon: LucideIcon
  title: string
  steps: React.ReactNode[]
}) {
  return (
    <div className='border-border/60 bg-card/60 rounded-2xl border p-5 backdrop-blur-sm'>
      <div className='mb-4 flex items-center gap-2.5'>
        <span className='bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg'>
          <props.icon className='size-4' />
        </span>
        <h3 className='font-semibold'>{props.title}</h3>
      </div>
      <ol className='space-y-2.5'>
        {props.steps.map((step, i) => (
          <li
            // 静态步骤列表，顺序不可变
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            className='text-muted-foreground flex items-start gap-2.5 text-sm'
          >
            <span className='border-border text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]'>
              {i + 1}
            </span>
            <span className='leading-relaxed'>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function DeveloperDocs() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const [activeTab, setActiveTab] = useState<DocsTabId>('language')
  const [activeSection, setActiveSection] = useState('')
  const siteUrl = useMemo(() => resolveDocsSiteUrl(status), [status])
  const gettingStarted = useMemo(() => getGettingStarted(siteUrl), [siteUrl])
  const sections = useMemo(
    () => getDocSections(activeTab, siteUrl),
    [activeTab, siteUrl]
  )

  // 滚动定位当前章节，高亮左侧目录
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id)
        }
      },
      { rootMargin: '-25% 0px -65% 0px' }
    )
    for (const s of sections) {
      const el = document.querySelector(`#${s.id}`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sections])

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-20 dark:opacity-[0.10]'
          style={{
            background: [
              'radial-gradient(ellipse 55% 45% at 15% 20%, oklch(0.72 0.14 160 / 70%) 0%, transparent 70%)',
              'radial-gradient(ellipse 50% 40% at 85% 15%, oklch(0.65 0.15 250 / 60%) 0%, transparent 70%)',
              'radial-gradient(ellipse 40% 35% at 50% 60%, oklch(0.70 0.12 200 / 40%) 0%, transparent 70%)',
            ].join(', '),
            maskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
          }}
        />
        <PageTransition className='relative mx-auto w-full max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-24'>
          {/* 页头 */}
          <header className='mx-auto mb-10 max-w-3xl text-center sm:mb-14'>
            <h1 className='text-[clamp(1.9rem,5vw,3rem)] leading-[1.15] font-bold tracking-tight'>
              {t('Developer Docs')}
            </h1>
            <div className='mt-5 flex flex-wrap items-center justify-center gap-2.5'>
              <span className='border-border/70 bg-card/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-xs backdrop-blur-sm'>
                <Globe className='text-muted-foreground size-3.5' />
                <span className='text-muted-foreground font-sans'>
                  Base URL
                </span>
                {siteUrl}
              </span>
              <span className='border-border/70 bg-card/70 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-xs backdrop-blur-sm'>
                <ShieldCheck className='text-muted-foreground size-3.5' />
                Authorization: Bearer sk-你的token
              </span>
            </div>
          </header>

          {/* 准备工作 */}
          <div className='mb-12 grid gap-4 sm:mb-16 md:grid-cols-2'>
            <GettingStartedCard
              icon={Globe}
              title={gettingStarted.webTest.title}
              steps={gettingStarted.webTest.steps}
            />
            <GettingStartedCard
              icon={KeyRound}
              title={gettingStarted.apiKey.title}
              steps={gettingStarted.apiKey.steps}
            />
          </div>

          {/* 模型类型页签 */}
          <div className='mb-8 flex flex-wrap items-center gap-2'>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type='button'
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200',
                  activeTab === tab.id
                    ? TAB_ACTIVE_STYLES[tab.id]
                    : 'border-border/60 bg-card/50 text-muted-foreground hover:border-border hover:text-foreground'
                )}
              >
                <tab.icon className='size-4' />
                {tab.label}
              </button>
            ))}
          </div>

          {/* 目录 + 正文 */}
          <div className='grid gap-10 lg:grid-cols-[190px_minmax(0,1fr)]'>
            <nav className='hidden lg:block'>
              <div className='sticky top-24 space-y-1'>
                {sections.map((s, i) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className={cn(
                      'group flex items-baseline gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                      activeSection === s.id
                        ? 'bg-primary/10 text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span className='text-muted-foreground/60 font-mono text-[10px]'>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className='leading-snug'>{s.title}</span>
                  </a>
                ))}
              </div>
            </nav>

            <div className='min-w-0 space-y-12'>
              {sections.map((s, i) => (
                <section key={s.id} id={s.id} className='scroll-mt-24'>
                  <h2 className='mb-4 flex items-baseline gap-3 text-lg font-semibold tracking-tight'>
                    <span className='text-muted-foreground/50 font-mono text-sm font-normal'>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {s.title}
                  </h2>
                  <div className='space-y-4'>{s.body}</div>
                </section>
              ))}

              <p className='text-muted-foreground/70 border-border/60 border-t pt-6 text-xs leading-relaxed'>
                提示：本文示例中的模型 ID 仅作演示，实际可用模型及价格以「
                <a href='/pricing' className='text-primary hover:underline'>
                  模型广场
                </a>
                」页面为准。
              </p>
            </div>
          </div>
        </PageTransition>
      </div>
    </PublicLayout>
  )
}
