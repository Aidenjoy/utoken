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
import { Clipboard, Image as ImageIcon, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { CanvasTheme } from '../canvas-theme'
import { CANVAS_NODE_TITLE_KEYS, type CanvasNode } from '../types'
import { CanvasModal } from './canvas-modal'

// ===== 节点信息弹窗（右键「节点信息与标签」）与文本放大编辑弹窗 =====

async function copyText(
  text: string,
  successMessage: string,
  failureMessage: string
) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.error(failureMessage)
  }
}

export function CanvasNodeInfoModal(props: {
  theme: CanvasTheme
  node: CanvasNode
  onClose: () => void
}) {
  const { theme, node, onClose } = props
  const { t } = useTranslation()

  const rows: { label: string; value: string }[] = [
    { label: t('Type'), value: t(CANVAS_NODE_TITLE_KEYS[node.type]) },
    {
      label: t('Size'),
      value: `${Math.round(node.width)} × ${Math.round(node.height)}`,
    },
    {
      label: t('Position'),
      value: `${Math.round(node.position.x)}, ${Math.round(node.position.y)}`,
    },
  ]
  if (node.metadata.size) {
    rows.push({ label: t('Image size'), value: node.metadata.size })
  }
  if (node.metadata.aspectRatio) {
    rows.push({ label: t('Aspect ratio'), value: node.metadata.aspectRatio })
  }
  if (node.metadata.resolution) {
    rows.push({ label: t('Resolution'), value: node.metadata.resolution })
  }
  if (node.metadata.duration) {
    rows.push({ label: t('Duration'), value: `${node.metadata.duration}s` })
  }
  if (node.metadata.generationId) {
    rows.push({
      label: t('Generation ID'),
      value: String(node.metadata.generationId),
    })
  }

  return (
    <CanvasModal
      theme={theme}
      title={t('Node info & tags')}
      onClose={onClose}
      width={480}
    >
      <div className='flex flex-col gap-3 p-4'>
        <div
          className='rounded-xl px-3 py-2.5'
          style={{
            background: theme.node.fill,
            border: `1px solid ${theme.toolbar.border}`,
          }}
        >
          <p className='text-xs font-medium' style={{ color: theme.node.text }}>
            {node.title}
          </p>
        </div>
        <dl className='flex flex-col gap-1.5'>
          {rows.map((row) => (
            <div
              key={row.label}
              className='flex items-center justify-between gap-3 text-xs'
            >
              <dt style={{ color: theme.node.faint }}>{row.label}</dt>
              <dd
                className='truncate tabular-nums'
                style={{ color: theme.node.muted }}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        {node.metadata.prompt && (
          <div>
            <div className='mb-1 flex items-center justify-between'>
              <span className='text-[11px]' style={{ color: theme.node.faint }}>
                {t('Prompt')}
              </span>
              <button
                type='button'
                onClick={() =>
                  void copyText(
                    node.metadata.prompt ?? '',
                    t('Prompt copied'),
                    t('Clipboard unavailable')
                  )
                }
                className='flex cursor-pointer items-center gap-1 text-[11px]'
                style={{ color: theme.node.muted }}
              >
                <Clipboard aria-hidden='true' className='size-3' />
                {t('Copy')}
              </button>
            </div>
            <p
              className='canvas-scroll max-h-32 overflow-y-auto rounded-xl p-3 text-[11px] leading-relaxed whitespace-pre-wrap'
              style={{
                background: theme.node.fill,
                border: `1px solid ${theme.toolbar.border}`,
                color: theme.node.muted,
              }}
            >
              {node.metadata.prompt}
            </p>
          </div>
        )}
        {node.metadata.url && (
          <div className='flex items-center gap-2'>
            <p
              className='min-w-0 flex-1 truncate text-[11px]'
              style={{ color: theme.node.faint }}
              title={node.metadata.url}
            >
              {node.metadata.url}
            </p>
            <button
              type='button'
              onClick={() =>
                void copyText(
                  node.metadata.url ?? '',
                  t('Link copied'),
                  t('Clipboard unavailable')
                )
              }
              className='flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-[11px]'
              style={{
                background: theme.toolbar.itemHover,
                color: theme.node.text,
              }}
            >
              <Clipboard aria-hidden='true' className='size-3' />
              {t('Copy link')}
            </button>
          </div>
        )}
      </div>
    </CanvasModal>
  )
}

export function CanvasTextEditModal(props: {
  theme: CanvasTheme
  node: CanvasNode
  onClose: () => void
  onChange: (content: string) => void
  onBeginEdit: () => void
  onEndEdit: () => void
  onGenerateImage: (node: CanvasNode) => void
}) {
  const {
    theme,
    node,
    onClose,
    onChange,
    onBeginEdit,
    onEndEdit,
    onGenerateImage,
  } = props
  const { t } = useTranslation()

  return (
    <CanvasModal
      theme={theme}
      title={node.title}
      onClose={onClose}
      width={680}
      headerExtra={
        <button
          type='button'
          disabled={!(node.metadata.content ?? '').trim()}
          onClick={() => {
            onGenerateImage(node)
            onClose()
          }}
          className='flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs disabled:opacity-40'
          style={{
            background: theme.accent.primary,
            color: theme.accent.onPrimary,
          }}
        >
          <ImageIcon aria-hidden='true' className='size-3.5' />
          {t('Generate image from text')}
        </button>
      }
    >
      <div className='p-4'>
        <textarea
          value={node.metadata.content ?? ''}
          autoFocus
          onFocus={onBeginEdit}
          onBlur={onEndEdit}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('Type your idea, prompt or note here...')}
          aria-label={t('Node text')}
          className='canvas-scroll h-[52vh] w-full resize-none rounded-xl p-4 text-sm leading-relaxed outline-none'
          style={{
            background: theme.node.fill,
            color: theme.node.text,
            border: `1px solid ${theme.toolbar.border}`,
          }}
        />
        <p
          className='mt-2 flex items-center gap-1 text-[11px]'
          style={{ color: theme.node.faint }}
        >
          <Sparkles aria-hidden='true' className='size-3' />
          {t('Changes are saved to the node automatically')}
        </p>
      </div>
    </CanvasModal>
  )
}
