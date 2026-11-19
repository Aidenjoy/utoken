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
  Image as ImageIcon,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Type,
  Video,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { submitCanvasAgentDraft } from '../api'
import type { CanvasTheme } from '../canvas-theme'
import type { CanvasDraft } from '../types'
import { CanvasDrawer } from './canvas-modal'

// ===== Agent 草案助手（⌘J：描述需求 → 文本模型产出节点草案 → 预览后应用到画布） =====

const DRAFT_TYPE_ICON = {
  text: Type,
  image: ImageIcon,
  video: Video,
} as const

export function CanvasAgentPanel(props: {
  theme: CanvasTheme
  projectId: number
  onClose: () => void
  onApply: (draft: CanvasDraft) => void
}) {
  const { theme, projectId, onClose, onApply } = props
  const { t } = useTranslation()
  const [prompt, setPrompt] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [draft, setDraft] = React.useState<CanvasDraft | null>(null)
  const [error, setError] = React.useState('')

  const generateDraft = async () => {
    const trimmed = prompt.trim()
    if (!trimmed || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await submitCanvasAgentDraft(projectId, trimmed)
      if (res.success && res.data) {
        setDraft(res.data)
      } else {
        setError(res.message || t('Failed to generate draft'))
      }
    } catch {
      setError(t('Failed to generate draft'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <CanvasDrawer
      theme={theme}
      title={t('AI Agent')}
      onClose={onClose}
      width={380}
    >
      <div className='flex flex-col gap-3 p-4'>
        <p
          className='text-[11px] leading-relaxed'
          style={{ color: theme.node.muted }}
        >
          {t(
            'Describe your creative idea. The assistant drafts a node canvas with prompts and reference links, which you can apply and refine.'
          )}
        </p>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void generateDraft()
            }
          }}
          placeholder={t('Describe what you want to create...')}
          aria-label={t('Creative brief')}
          rows={5}
          className='canvas-scroll w-full resize-none rounded-xl p-3 text-xs leading-relaxed outline-none'
          style={{
            background: theme.toolbar.itemHover,
            color: theme.node.text,
            border: `1px solid ${theme.toolbar.border}`,
          }}
        />
        <button
          type='button'
          disabled={loading || !prompt.trim()}
          onClick={() => void generateDraft()}
          className='flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-xs font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40'
          style={{
            background: theme.accent.primary,
            color: theme.accent.onPrimary,
          }}
        >
          {loading ? (
            <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />
          ) : (
            <Sparkles aria-hidden='true' className='size-3.5' />
          )}
          {loading ? t('Drafting...') : t('Generate draft')}
        </button>

        {error && (
          <p
            className='rounded-lg px-3 py-2 text-[11px] leading-relaxed'
            style={{
              background: 'rgba(248,113,113,.12)',
              color: theme.accent.danger,
            }}
          >
            {error}
          </p>
        )}

        {draft && (
          <div className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
              <h3
                className='text-xs font-semibold'
                style={{ color: theme.node.text }}
              >
                {t('Draft preview')}
              </h3>
              <span
                className='flex items-center gap-1 text-[10px] tabular-nums'
                style={{ color: theme.node.faint }}
              >
                <Link2 aria-hidden='true' className='size-3' />
                {t('{{count}} connections', {
                  count: draft.connections.length,
                })}
              </span>
            </div>
            {draft.nodes.map((node, index) => {
              const Icon = DRAFT_TYPE_ICON[node.type]
              return (
                <div
                  // 草案预览为静态卡片，用下标组合 key 即可
                  // eslint-disable-next-line react/no-array-index-key
                  key={`${node.type}-${index}`}
                  className='rounded-xl p-3'
                  style={{
                    background: theme.node.fill,
                    border: `1px solid ${theme.toolbar.border}`,
                  }}
                >
                  <div className='flex items-center gap-1.5'>
                    <Icon
                      aria-hidden='true'
                      className='size-3.5 shrink-0'
                      style={{ color: theme.node.muted }}
                    />
                    <span
                      className='min-w-0 flex-1 truncate text-xs font-medium'
                      style={{ color: theme.node.text }}
                    >
                      {node.title || t('Untitled node')}
                    </span>
                    <span
                      className='shrink-0 text-[10px] tabular-nums'
                      style={{ color: theme.node.faint }}
                    >
                      #{index + 1}
                    </span>
                  </div>
                  <p
                    className='mt-1.5 line-clamp-3 text-[11px] leading-relaxed'
                    style={{ color: theme.node.muted }}
                  >
                    {node.type === 'text' ? node.content : node.prompt}
                  </p>
                </div>
              )
            })}
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={() => {
                  onApply(draft)
                  onClose()
                }}
                className='flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-xs font-medium'
                style={{
                  background: theme.accent.primary,
                  color: theme.accent.onPrimary,
                }}
              >
                <Sparkles aria-hidden='true' className='size-3.5' />
                {t('Apply to canvas')}
              </button>
              <button
                type='button'
                disabled={loading}
                onClick={() => void generateDraft()}
                className='flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-xs disabled:opacity-40'
                style={{
                  border: `1px solid ${theme.toolbar.border}`,
                  color: theme.node.muted,
                }}
                title={t('Regenerate draft')}
              >
                <RefreshCw aria-hidden='true' className='size-3.5' />
              </button>
            </div>
          </div>
        )}
      </div>
    </CanvasDrawer>
  )
}
