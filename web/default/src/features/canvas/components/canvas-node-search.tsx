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
import { Search } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import { CANVAS_NODE_TITLE_KEYS, type CanvasNode } from '../types'
import { CanvasMenuPanel, CanvasMenuRow } from './canvas-menu'

// ===== 画布节点搜索（⌘F：按标题/类型过滤，点击定位并选中节点） =====

export function CanvasNodeSearch(props: {
  theme: CanvasTheme
  nodes: CanvasNode[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  const { theme, nodes, onPick, onClose } = props
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')

  const normalized = query.trim().toLowerCase()
  const matches = nodes.filter((node) => {
    if (!normalized) return true
    return (
      node.title.toLowerCase().includes(normalized) ||
      t(CANVAS_NODE_TITLE_KEYS[node.type]).toLowerCase().includes(normalized) ||
      (node.metadata.prompt ?? '').toLowerCase().includes(normalized)
    )
  })

  return (
    <CanvasMenuPanel
      theme={theme}
      x={Math.max(8, window.innerWidth / 2 - 180)}
      y={72}
      width={360}
      onClose={onClose}
      ariaLabel={t('Search canvas nodes')}
    >
      <div className='flex items-center gap-2 px-3 pt-1 pb-2'>
        <Search
          aria-hidden='true'
          className='size-3.5 shrink-0'
          style={{ color: theme.node.faint }}
        />
        <input
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Search canvas nodes')}
          aria-label={t('Search canvas nodes')}
          className='h-7 min-w-0 flex-1 bg-transparent text-xs outline-none'
          style={{ color: theme.node.text }}
        />
        <span
          className='shrink-0 text-[10px] tabular-nums'
          style={{ color: theme.node.faint }}
        >
          {matches.length}/{nodes.length}
        </span>
      </div>
      {matches.length === 0 ? (
        <p
          className='px-3 py-3 text-center text-[11px]'
          style={{ color: theme.node.faint }}
        >
          {t('No matching nodes')}
        </p>
      ) : (
        matches.slice(0, 30).map((node) => (
          <CanvasMenuRow
            key={node.id}
            theme={theme}
            icon={
              <span className='text-[10px]'>
                {t(CANVAS_NODE_TITLE_KEYS[node.type]).slice(0, 2)}
              </span>
            }
            label={node.title}
            onClick={() => {
              onPick(node.id)
              onClose()
            }}
          />
        ))
      )}
    </CanvasMenuPanel>
  )
}
