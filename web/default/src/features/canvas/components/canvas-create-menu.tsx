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
  Clock3,
  Folder,
  FolderOpen,
  Frame,
  Image as ImageIcon,
  Layers3,
  Music2,
  Pencil,
  Scissors,
  Search,
  Table2,
  Type,
  UploadCloud,
  Video,
  WandSparkles,
  X,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import { CanvasMenuRow } from './canvas-menu'

// ===== 添加节点命令表（移植自 BeefTV canvas-create-menu：分区/搜索/进阶隐藏/开发中徽章） =====

export type CanvasCreateCommandId =
  | 'text'
  | 'image'
  | 'video'
  | 'upscale'
  | 'audio'
  | 'director'
  | 'smart-edit'
  | 'frame'
  | 'script'
  | 'drawing'
  | 'folder'
  | 'batch'
  | 'upload'
  | 'generation-history'
  | 'assets'

interface CreateCommand {
  id: CanvasCreateCommandId
  labelKey: string
  icon: React.ReactNode
  section: 'node' | 'resource'
  badgeKey?: string
  disabled?: boolean
  advanced?: boolean
}

const ICON_CLASS = 'size-4'

const CREATE_COMMANDS: CreateCommand[] = [
  {
    id: 'text',
    labelKey: 'Text',
    icon: <Type className={ICON_CLASS} />,
    section: 'node',
  },
  {
    id: 'image',
    labelKey: 'Image',
    icon: <ImageIcon className={ICON_CLASS} />,
    section: 'node',
  },
  {
    id: 'video',
    labelKey: 'Video',
    icon: <Video className={ICON_CLASS} />,
    section: 'node',
  },
  {
    id: 'upscale',
    labelKey: 'AI upscale',
    icon: <WandSparkles className={ICON_CLASS} />,
    section: 'node',
  },
  {
    id: 'audio',
    labelKey: 'Audio',
    icon: <Music2 className={ICON_CLASS} />,
    section: 'node',
  },
  {
    id: 'director',
    labelKey: 'Director studio',
    icon: <Layers3 className={ICON_CLASS} />,
    section: 'node',
  },
  {
    id: 'smart-edit',
    labelKey: 'Smart editing',
    icon: <Scissors className={ICON_CLASS} />,
    section: 'node',
    badgeKey: 'In development',
    disabled: true,
  },
  {
    id: 'frame',
    labelKey: 'Frame analysis',
    icon: <Frame className={ICON_CLASS} />,
    section: 'node',
    badgeKey: 'In development',
    disabled: true,
  },
  {
    id: 'script',
    labelKey: 'Storyboard script',
    icon: <Clapperboard className={ICON_CLASS} />,
    section: 'node',
  },
  {
    id: 'drawing',
    labelKey: 'Drawing',
    icon: <Pencil className={ICON_CLASS} />,
    section: 'node',
    advanced: true,
  },
  {
    id: 'folder',
    labelKey: 'Folder',
    icon: <Folder className={ICON_CLASS} />,
    section: 'node',
    advanced: true,
  },
  {
    id: 'batch',
    labelKey: 'Batch table',
    icon: <Table2 className={ICON_CLASS} />,
    section: 'node',
    advanced: true,
  },
  {
    id: 'upload',
    labelKey: 'Upload',
    icon: <UploadCloud className={ICON_CLASS} />,
    section: 'resource',
  },
  {
    id: 'generation-history',
    labelKey: 'Pick from generation history',
    icon: <Clock3 className={ICON_CLASS} />,
    section: 'resource',
  },
  {
    id: 'assets',
    labelKey: 'Asset library',
    icon: <FolderOpen className={ICON_CLASS} />,
    section: 'resource',
  },
]

// 未开发完的节点类型暂不上线：默认从创建菜单隐藏（搜索也不召回），
// 开发完成后删除本集合即可恢复；本地调试/E2E 可置 localStorage 召回
const UNRELEASED_COMMAND_IDS = new Set<CanvasCreateCommandId>([
  'upscale',
  'audio',
  'director',
  'smart-edit',
  'frame',
  'script',
])

export function CanvasCreateList(props: {
  theme: CanvasTheme
  onCommand: (id: CanvasCreateCommandId) => void
  includeResources?: boolean
  nodeTypesOnly?: boolean
  title?: string
}) {
  const {
    theme,
    onCommand,
    includeResources = true,
    nodeTypesOnly = false,
    title,
  } = props
  const { t } = useTranslation()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const normalizedQuery = query.trim().toLowerCase()
  const showUnreleased =
    window.localStorage.getItem('canvas-show-unreleased') === '1'
  const creatableTypes = new Set<CanvasCreateCommandId>([
    'text',
    'image',
    'video',
    'upscale',
    'audio',
    'director',
    'script',
    'drawing',
    'folder',
    'batch',
  ])
  const visible = CREATE_COMMANDS.filter((command) => {
    if (!showUnreleased && UNRELEASED_COMMAND_IDS.has(command.id)) return false
    if (command.section === 'resource' && !includeResources) return false
    if (nodeTypesOnly && !creatableTypes.has(command.id)) return false
    // 无搜索词时隐藏进阶节点（绘图/文件夹/批量创作表），搜索可召回
    if (!normalizedQuery && command.advanced) return false
    if (!normalizedQuery) return true
    return (
      t(command.labelKey).toLowerCase().includes(normalizedQuery) ||
      command.id.includes(normalizedQuery)
    )
  })
  const nodeCommands = visible.filter((c) => c.section === 'node')
  const resourceCommands = visible.filter((c) => c.section === 'resource')

  const renderRows = (commands: CreateCommand[]) =>
    commands.map((command) => (
      <CanvasMenuRow
        key={command.id}
        theme={theme}
        icon={command.icon}
        label={t(command.labelKey)}
        badge={command.badgeKey ? t(command.badgeKey) : undefined}
        disabled={command.disabled}
        onClick={() => onCommand(command.id)}
      />
    ))

  return (
    <div data-canvas-create-list>
      <div className='flex items-center gap-1 px-3 pt-1 pb-1.5'>
        {searchOpen ? (
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setQuery('')
                setSearchOpen(false)
              }
            }}
            placeholder={t('Search nodes')}
            aria-label={t('Search nodes')}
            className='h-7 min-w-0 flex-1 rounded-md px-2 text-xs outline-none'
            style={{
              background: theme.toolbar.itemHover,
              color: theme.toolbar.item,
              border: `1px solid ${theme.toolbar.border}`,
            }}
          />
        ) : (
          <span
            className='min-w-0 flex-1 truncate text-[11px] font-medium'
            style={{ color: theme.node.faint }}
          >
            {title ?? t('Add node')}
          </span>
        )}
        <button
          type='button'
          onClick={() => {
            if (searchOpen) setQuery('')
            setSearchOpen((prev) => !prev)
          }}
          className='flex size-6 shrink-0 items-center justify-center rounded-md transition-colors'
          style={{ color: theme.node.muted }}
          aria-label={searchOpen ? t('Close search') : t('Search nodes')}
          title={searchOpen ? t('Close search') : t('Search nodes')}
        >
          {searchOpen ? (
            <X aria-hidden='true' className='size-3.5' />
          ) : (
            <Search aria-hidden='true' className='size-3.5' />
          )}
        </button>
      </div>
      {nodeCommands.length > 0 && (
        <>
          <div
            className='px-3 pt-1 pb-1 text-[10px] font-semibold tracking-wider uppercase'
            style={{ color: theme.node.faint }}
          >
            {t('Creation nodes')}
          </div>
          {renderRows(nodeCommands)}
        </>
      )}
      {resourceCommands.length > 0 && (
        <>
          <div
            className='px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase'
            style={{ color: theme.node.faint }}
          >
            {t('Import resources')}
          </div>
          {renderRows(resourceCommands)}
        </>
      )}
      {visible.length === 0 && (
        <p
          className='px-3 py-3 text-center text-[11px]'
          style={{ color: theme.node.faint }}
        >
          {t('No matching nodes')}
        </p>
      )}
    </div>
  )
}
