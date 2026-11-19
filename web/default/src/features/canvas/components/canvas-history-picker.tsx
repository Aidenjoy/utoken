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
import { Clock3, Loader2, RefreshCw, Sparkles, Video } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { getCanvasGenerations } from '../api'
import type { CanvasTheme } from '../canvas-theme'
import type { CanvasGeneration } from '../types'
import { CanvasModal } from './canvas-modal'

// ===== 生成历史选择器（移植自 BeefTV canvas-generation-history-picker：按日分组/悬停预览/点击插入） =====

const PAGE_SIZE = 60

function dayKey(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleDateString('sv-SE')
}

export function CanvasHistoryPicker(props: {
  theme: CanvasTheme
  projectId: number
  onClose: () => void
  onInsert: (generation: CanvasGeneration) => void
}) {
  const { theme, projectId, onClose, onInsert } = props
  const { t } = useTranslation()
  const [items, setItems] = React.useState<CanvasGeneration[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)
  const requestIdRef = React.useRef(0)

  const loadPage = React.useCallback(
    async (nextPage: number, append: boolean) => {
      const requestId = ++requestIdRef.current
      setLoading(true)
      setError(false)
      try {
        const res = await getCanvasGenerations({
          projectId,
          p: nextPage,
          page_size: PAGE_SIZE,
        })
        if (requestId !== requestIdRef.current) return
        const data = res.success ? res.data : undefined
        if (data) {
          setItems((prev) => (append ? [...prev, ...data.list] : data.list))
          setTotal(data.total)
          setPage(nextPage)
        } else {
          setError(true)
        }
      } catch {
        if (requestId === requestIdRef.current) setError(true)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    },
    [projectId]
  )

  React.useEffect(() => {
    void loadPage(1, false)
  }, [loadPage])

  const groups = React.useMemo(() => {
    const map = new Map<string, CanvasGeneration[]>()
    for (const item of items) {
      const key = dayKey(item.createdAt)
      const list = map.get(key)
      if (list) list.push(item)
      else map.set(key, [item])
    }
    return [...map.entries()]
  }, [items])

  return (
    <CanvasModal
      theme={theme}
      title={t('Generation history')}
      onClose={onClose}
      width={760}
    >
      {error && (
        <div className='flex flex-col items-center gap-3 py-16'>
          <p className='text-xs' style={{ color: theme.node.muted }}>
            {t('Failed to load generation history')}
          </p>
          <button
            type='button'
            onClick={() => void loadPage(1, false)}
            className='flex h-7 cursor-pointer items-center gap-1 rounded-lg px-3 text-xs'
            style={{
              background: theme.toolbar.itemHover,
              color: theme.node.text,
            }}
          >
            <RefreshCw aria-hidden='true' className='size-3' />
            {t('Retry')}
          </button>
        </div>
      )}
      {!error && items.length === 0 && !loading && (
        <div className='flex flex-col items-center gap-2 py-16'>
          <Clock3
            aria-hidden='true'
            className='size-8'
            style={{ color: theme.node.faint }}
          />
          <p className='text-xs' style={{ color: theme.node.muted }}>
            {t('No generations yet')}
          </p>
          <p className='text-[11px]' style={{ color: theme.node.faint }}>
            {t('Generated images and videos will appear here')}
          </p>
        </div>
      )}
      {!error && (items.length > 0 || loading) && (
        <div className='p-4'>
          {groups.map(([day, generations]) => (
            <section key={day} className='mb-5'>
              <h3
                className='mb-2 text-[11px] font-semibold tabular-nums'
                style={{ color: theme.node.faint }}
              >
                {day}
              </h3>
              <div className='grid grid-cols-[repeat(auto-fill,minmax(142px,1fr))] gap-3'>
                {generations.map((generation) => {
                  const insertable =
                    generation.status === 'success' && generation.resultUrl
                  let statusLabel = t('Processing')
                  let statusColor = '#fcd34d'
                  if (generation.status === 'failed') {
                    statusLabel = t('Failed')
                    statusColor = '#fb7185'
                  } else if (generation.status === 'cancelled') {
                    statusLabel = t('Cancelled')
                    statusColor = '#a1a1aa'
                  }
                  return (
                    <button
                      key={generation.id}
                      type='button'
                      disabled={!insertable}
                      onClick={() => onInsert(generation)}
                      className='group/gen cursor-pointer overflow-hidden rounded-xl text-left transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0'
                      style={{
                        border: `1px solid ${theme.toolbar.border}`,
                        background: theme.node.fill,
                      }}
                      title={generation.prompt}
                    >
                      <div
                        className='relative flex aspect-square items-center justify-center overflow-hidden'
                        style={{ background: 'rgba(0,0,0,.25)' }}
                      >
                        {generation.resultUrl &&
                          (generation.kind === 'video' ? (
                            <video
                              src={generation.resultUrl}
                              muted
                              playsInline
                              preload='metadata'
                              className='size-full object-cover'
                              onMouseEnter={(event) => {
                                void event.currentTarget.play().catch(() => {})
                              }}
                              onMouseLeave={(event) => {
                                event.currentTarget.pause()
                                event.currentTarget.currentTime = 0
                              }}
                            />
                          ) : (
                            <img
                              src={generation.resultUrl}
                              alt={generation.prompt}
                              loading='lazy'
                              draggable={false}
                              className='size-full object-cover'
                            />
                          ))}
                        {!generation.resultUrl && (
                          <Loader2
                            aria-hidden='true'
                            className={`size-6 ${generation.status === 'processing' ? 'animate-spin' : ''}`}
                            style={{ color: theme.node.faint }}
                          />
                        )}
                        <span
                          className='absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium'
                          style={{
                            background: 'rgba(0,0,0,.55)',
                            color: '#fff',
                          }}
                        >
                          {generation.kind === 'video' ? (
                            <Video aria-hidden='true' className='size-2.5' />
                          ) : (
                            <Sparkles aria-hidden='true' className='size-2.5' />
                          )}
                          {t('AI generated')}
                        </span>
                        {generation.status !== 'success' && (
                          <span
                            className='absolute right-1.5 bottom-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-medium'
                            style={{
                              background: 'rgba(0,0,0,.55)',
                              color: statusColor,
                            }}
                          >
                            {statusLabel}
                          </span>
                        )}
                      </div>
                      <p
                        className='line-clamp-2 px-2 py-1.5 text-[11px] leading-snug'
                        style={{ color: theme.node.muted }}
                      >
                        {generation.prompt}
                      </p>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          <div className='flex justify-center pb-2'>
            {loading ? (
              <Loader2
                aria-hidden='true'
                className='size-5 animate-spin'
                style={{ color: theme.node.muted }}
              />
            ) : (
              items.length < total && (
                <button
                  type='button'
                  onClick={() => void loadPage(page + 1, true)}
                  className='h-8 cursor-pointer rounded-lg px-4 text-xs transition-colors'
                  style={{
                    background: theme.toolbar.itemHover,
                    color: theme.node.text,
                  }}
                >
                  {t('Load more')}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </CanvasModal>
  )
}
