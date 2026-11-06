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
  CircleHelp,
  Clapperboard,
  Image as ImageIcon,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { PublicLayout } from '@/components/layout'
import { PageTopGlow } from '@/components/page-top-glow'
import { PageTransition } from '@/components/page-transition'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import {
  flattenDocSections,
  getDocSections,
  resolveDocsSiteUrl,
  type DocSection,
  type DocsTabId,
} from './content'
import { videoKeySection } from './video-key-section'
import { buildVideoTaskSections } from './video-task-sections'

const TABS: { id: DocsTabId; label: string; icon: LucideIcon }[] = [
  { id: 'language', label: '语言模型', icon: MessageSquareText },
  { id: 'image', label: '图片模型', icon: ImageIcon },
  { id: 'video', label: '视频模型', icon: Clapperboard },
  { id: 'faq', label: '常见问题', icon: CircleHelp },
]

const TAB_ACTIVE_STYLES: Record<DocsTabId, string> = {
  language:
    'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  image:
    'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  video: 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  faq: 'border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

// 侧边栏递归渲染：一级编号章节 → 二级条目 → 三级接口，子级用左侧树线缩进。
function DocNavList(props: {
  sections: DocSection[]
  depth: number
  activeSection: string
  activePath: Set<string>
}) {
  const { sections, depth, activeSection, activePath } = props
  return (
    <div className={depth === 0 ? 'space-y-1' : 'space-y-0.5'}>
      {sections.map((s, i) => {
        const isActive = activeSection === s.id
        const onPath = activePath.has(s.id)
        let stateClass = 'text-muted-foreground hover:text-foreground'
        if (onPath) stateClass = 'text-foreground/80 font-medium'
        if (isActive) stateClass = 'bg-primary/10 text-foreground font-medium'
        return (
          <div key={s.id}>
            <a
              href={`#${s.id}`}
              className={cn(
                'group flex items-baseline gap-2.5 rounded-lg px-2.5 transition-colors',
                depth === 0 && 'py-1.5 text-[13px]',
                depth === 1 && 'py-1 pl-5 text-[13px]',
                depth >= 2 && 'py-1 pl-8 text-xs',
                stateClass
              )}
            >
              {depth === 0 && (
                <span className='text-muted-foreground/60 font-mono text-[10px]'>
                  {String(i + 1).padStart(2, '0')}
                </span>
              )}
              <span
                className={cn(
                  'leading-snug',
                  depth >= 2 && s.short && 'font-mono text-[11px]'
                )}
              >
                {s.short ?? s.title}
              </span>
            </a>
            {s.children && (
              <div className='border-border/50 ml-4 border-l pl-1.5'>
                <DocNavList
                  sections={s.children}
                  depth={depth + 1}
                  activeSection={activeSection}
                  activePath={activePath}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// 正文递归渲染：一级 h2（带编号）→ 二级 h3 → 三级接口卡片。
function DocSectionBlock(props: {
  section: DocSection
  depth: number
  number?: string
}) {
  const { section, depth, number } = props
  let heading: ReactNode
  if (depth === 0) {
    heading = (
      <h2 className='mb-4 flex items-baseline gap-3 text-lg font-semibold tracking-tight'>
        <span className='text-muted-foreground/50 font-mono text-sm font-normal'>
          {number}
        </span>
        {section.title}
      </h2>
    )
  } else if (depth === 1) {
    heading = (
      <h3 className='mb-3 text-base font-semibold tracking-tight'>
        {section.title}
      </h3>
    )
  } else {
    heading = <h4 className='mb-2 text-sm font-semibold'>{section.title}</h4>
  }
  return (
    <section id={section.id} className='scroll-mt-24'>
      {heading}
      <div className='space-y-4'>{section.body}</div>
      {section.children && (
        <div className={depth === 0 ? 'mt-8 space-y-8' : 'mt-6 space-y-6'}>
          {section.children.map((child) => (
            <div
              key={child.id}
              className={
                depth >= 1
                  ? 'border-border/60 bg-card/40 rounded-xl border p-4'
                  : undefined
              }
            >
              <DocSectionBlock section={child} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function DeveloperDocs() {
  const { status } = useStatus()
  const [activeTab, setActiveTab] = useState<DocsTabId>('video')
  const [activeSection, setActiveSection] = useState('')
  const siteUrl = useMemo(() => resolveDocsSiteUrl(status), [status])
  const sections = useMemo(() => {
    const docSections = getDocSections(activeTab, siteUrl)
    if (activeTab !== 'video') return docSections
    const queryIndex = docSections.findIndex(
      (section) => section.id === 'video-query'
    )
    const taskSections = buildVideoTaskSections(siteUrl)
    if (queryIndex < 0) {
      return [videoKeySection, ...docSections, ...taskSections]
    }
    return [
      videoKeySection,
      ...docSections.slice(0, queryIndex + 1),
      ...taskSections,
      ...docSections.slice(queryIndex + 1),
    ]
  }, [activeTab, siteUrl])

  const flatSections = useMemo(() => flattenDocSections(sections), [sections])

  // 滚动定位当前章节（含子章节）：取顶边已越过视口 30% 分位线的最后一个章节
  useEffect(() => {
    const locate = () => {
      const threshold = window.innerHeight * 0.3
      let current = flatSections[0]?.id ?? ''
      for (const s of flatSections) {
        const el = document.querySelector(`#${s.id}`)
        if (el && el.getBoundingClientRect().top <= threshold) current = s.id
      }
      setActiveSection(current)
    }
    locate()
    window.addEventListener('scroll', locate, { passive: true })
    return () => window.removeEventListener('scroll', locate)
  }, [flatSections])

  // 当前章节的祖先路径：用于二级菜单的连贯通称高亮
  const activePath = useMemo(() => {
    const path = new Set<string>()
    const walk = (list: DocSection[], trail: string[]): boolean => {
      for (const s of list) {
        if (s.id === activeSection) {
          for (const id of trail) path.add(id)
          return true
        }
        if (s.children && walk(s.children, [...trail, s.id])) return true
      }
      return false
    }
    walk(sections, [])
    return path
  }, [sections, activeSection])

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <PageTopGlow />
        <PageTransition className='relative mx-auto w-full max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-24'>
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
          <div className='grid gap-10 lg:grid-cols-[212px_minmax(0,1fr)]'>
            <nav className='hidden lg:block'>
              <div className='sticky top-24 max-h-[calc(100vh-7rem)] space-y-1 overflow-y-auto pr-1 pb-2'>
                <DocNavList
                  sections={sections}
                  depth={0}
                  activeSection={activeSection}
                  activePath={activePath}
                />
              </div>
            </nav>

            <div className='min-w-0 space-y-12'>
              {sections.map((s, i) => (
                <DocSectionBlock
                  key={s.id}
                  section={s}
                  depth={0}
                  number={String(i + 1).padStart(2, '0')}
                />
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
