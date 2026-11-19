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
  Clipboard,
  ClipboardPaste,
  Copy,
  FolderClosed,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Maximize2,
  Plus,
  Redo2,
  Tags,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import type { CanvasNode, CanvasPosition } from '../types'
import {
  CanvasCreateList,
  type CanvasCreateCommandId,
} from './canvas-create-menu'
import {
  CanvasMenuButton,
  CanvasMenuDivider,
  CanvasMenuHeader,
  CanvasMenuPanel,
  CanvasMenuSection,
} from './canvas-menu'
import { modKey, shiftModKey } from './canvas-menu-utils'

// ===== 右键上下文菜单（移植自 BeefTV：画布命令 / 节点命令 / 连接命令三形态） =====

export type CanvasContextMenuState =
  | { kind: 'canvas'; x: number; y: number; world: CanvasPosition }
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | { kind: 'connection'; x: number; y: number; connectionId: string }

interface CanvasContextMenuProps {
  theme: CanvasTheme
  state: CanvasContextMenuState
  nodes: CanvasNode[]
  selectedNodeIds: string[]
  canUndo: boolean
  canRedo: boolean
  canPaste: boolean
  onClose: () => void
  onCreateCommand: (id: CanvasCreateCommandId, world?: CanvasPosition) => void
  onUploadHere: (world: CanvasPosition) => void
  onOpenAssets: (world?: CanvasPosition) => void
  onUndo: () => void
  onRedo: () => void
  onPaste: (world?: CanvasPosition) => void
  onCopyNodes: () => void
  onDuplicateNodes: () => void
  onDeleteNodes: () => void
  onCopyText: (node: CanvasNode) => void
  onLightbox: (node: CanvasNode) => void
  onOpenHistory: () => void
  onNodeInfo: (node: CanvasNode) => void
  onExpandTextEdit: (node: CanvasNode) => void
  onTextToImage: (node: CanvasNode) => void
  onToggleFolder: (node: CanvasNode) => void
  onDeleteConnection: (connectionId: string) => void
}

export function CanvasContextMenu(props: CanvasContextMenuProps) {
  const {
    theme,
    state,
    nodes,
    selectedNodeIds,
    canUndo,
    canRedo,
    canPaste,
    onClose,
    onCreateCommand,
    onUploadHere,
    onOpenAssets,
    onUndo,
    onRedo,
    onPaste,
    onCopyNodes,
    onDuplicateNodes,
    onDeleteNodes,
    onCopyText,
    onLightbox,
    onOpenHistory,
    onNodeInfo,
    onExpandTextEdit,
    onTextToImage,
    onToggleFolder,
    onDeleteConnection,
  } = props
  const { t } = useTranslation()
  const [submenuOpen, setSubmenuOpen] = React.useState(false)

  const closeAll = React.useCallback(() => {
    setSubmenuOpen(false)
    onClose()
  }, [onClose])

  const run = (action: () => void) => () => {
    closeAll()
    action()
  }

  if (state.kind === 'connection') {
    return (
      <CanvasMenuPanel
        theme={theme}
        x={state.x}
        y={state.y}
        onClose={closeAll}
        ariaLabel={t('Connection')}
      >
        <CanvasMenuHeader theme={theme}>{t('Connection')}</CanvasMenuHeader>
        <CanvasMenuButton
          theme={theme}
          icon={<Trash2 className='size-3.5' />}
          label={t('Delete connection')}
          danger
          onClick={run(() => onDeleteConnection(state.connectionId))}
        />
      </CanvasMenuPanel>
    )
  }

  if (state.kind === 'node') {
    const node = nodes.find((n) => n.id === state.nodeId)
    if (!node) return null
    const multiCount =
      selectedNodeIds.length > 1 && selectedNodeIds.includes(node.id)
        ? selectedNodeIds.length
        : 0

    if (multiCount > 0) {
      return (
        <CanvasMenuPanel
          theme={theme}
          x={state.x}
          y={state.y}
          onClose={closeAll}
          ariaLabel={t('Node commands')}
        >
          <CanvasMenuHeader theme={theme}>
            {t('Selected {{count}} nodes', { count: multiCount })}
          </CanvasMenuHeader>
          <CanvasMenuButton
            theme={theme}
            icon={<Copy className='size-3.5' />}
            label={t('Copy {{count}} nodes', { count: multiCount })}
            shortcut={modKey('C')}
            onClick={run(onCopyNodes)}
          />
          <CanvasMenuButton
            theme={theme}
            icon={<Trash2 className='size-3.5' />}
            label={t('Delete {{count}} nodes', { count: multiCount })}
            danger
            onClick={run(onDeleteNodes)}
          />
        </CanvasMenuPanel>
      )
    }

    const isText = node.type === 'text'
    const hasMedia = Boolean(node.metadata.url)
    return (
      <CanvasMenuPanel
        theme={theme}
        x={state.x}
        y={state.y}
        onClose={closeAll}
        ariaLabel={t('Node commands')}
      >
        <CanvasMenuHeader theme={theme}>{node.title}</CanvasMenuHeader>
        {isText ? (
          <>
            <CanvasMenuButton
              theme={theme}
              icon={<Maximize2 className='size-3.5' />}
              label={t('Expand editing')}
              onClick={run(() => onExpandTextEdit(node))}
            />
            <CanvasMenuButton
              theme={theme}
              icon={<ImageIcon className='size-3.5' />}
              label={t('Generate image from text')}
              onClick={run(() => onTextToImage(node))}
            />
            <CanvasMenuDivider theme={theme} />
            <CanvasMenuButton
              theme={theme}
              icon={<Copy className='size-3.5' />}
              label={t('Copy node')}
              shortcut={modKey('C')}
              onClick={run(onCopyNodes)}
            />
            <CanvasMenuButton
              theme={theme}
              icon={<Clipboard className='size-3.5' />}
              label={t('Copy text')}
              onClick={run(() => onCopyText(node))}
            />
            <CanvasMenuButton
              theme={theme}
              icon={<Copy className='size-3.5' />}
              label={t('Create variant')}
              shortcut={modKey('D')}
              onClick={run(onDuplicateNodes)}
            />
            <CanvasMenuButton
              theme={theme}
              icon={<ClipboardPaste className='size-3.5' />}
              label={t('Paste')}
              shortcut={modKey('V')}
              disabled={!canPaste}
              onClick={run(() => onPaste())}
            />
          </>
        ) : (
          <>
            {node.type === 'folder' && (
              <CanvasMenuButton
                theme={theme}
                icon={
                  node.metadata.collapsed ? (
                    <FolderOpen className='size-3.5' />
                  ) : (
                    <FolderClosed className='size-3.5' />
                  )
                }
                label={
                  node.metadata.collapsed
                    ? t('Expand folder')
                    : t('Collapse folder')
                }
                onClick={run(() => onToggleFolder(node))}
              />
            )}
            {(node.type === 'image' ||
              node.type === 'video' ||
              node.type === 'audio' ||
              node.type === 'upscale' ||
              node.type === 'drawing') && (
              <>
                <CanvasMenuButton
                  theme={theme}
                  icon={<Maximize2 className='size-3.5' />}
                  label={t('Fullscreen preview')}
                  disabled={!hasMedia}
                  onClick={run(() => onLightbox(node))}
                />
                <CanvasMenuButton
                  theme={theme}
                  icon={<Info className='size-3.5' />}
                  label={t('Generation info & history')}
                  onClick={run(onOpenHistory)}
                />
                <CanvasMenuButton
                  theme={theme}
                  icon={<Tags className='size-3.5' />}
                  label={t('Node info & tags')}
                  onClick={run(() => onNodeInfo(node))}
                />
                <CanvasMenuDivider theme={theme} />
              </>
            )}
            <CanvasMenuButton
              theme={theme}
              icon={<Copy className='size-3.5' />}
              label={t('Copy node')}
              shortcut={modKey('C')}
              onClick={run(onCopyNodes)}
            />
            <CanvasMenuButton
              theme={theme}
              icon={<Copy className='size-3.5' />}
              label={t('Create variant')}
              shortcut={modKey('D')}
              onClick={run(onDuplicateNodes)}
            />
          </>
        )}
        <CanvasMenuButton
          theme={theme}
          icon={<Trash2 className='size-3.5' />}
          label={t('Delete node')}
          danger
          onClick={run(onDeleteNodes)}
        />
      </CanvasMenuPanel>
    )
  }

  // 画布空白处：画布命令 + 历史与剪贴板
  const submenuX =
    state.x + 224 + 8 > window.innerWidth - 240
      ? Math.max(8, state.x - 232 - 4)
      : state.x + 224 + 4
  return (
    <>
      <CanvasMenuPanel
        theme={theme}
        x={state.x}
        y={state.y}
        onClose={closeAll}
        ariaLabel={t('Canvas commands')}
      >
        <CanvasMenuHeader theme={theme}>
          {t('Canvas commands')}
        </CanvasMenuHeader>
        <CanvasMenuButton
          theme={theme}
          icon={<Plus className='size-3.5' />}
          label={t('Add node')}
          chevron
          active={submenuOpen}
          onClick={() => setSubmenuOpen(true)}
          onMouseEnter={() => setSubmenuOpen(true)}
        />
        <CanvasMenuButton
          theme={theme}
          icon={<Upload className='size-3.5' />}
          label={t('Upload here')}
          onClick={run(() => onUploadHere(state.world))}
        />
        <CanvasMenuButton
          theme={theme}
          icon={<FolderOpen className='size-3.5' />}
          label={t('Insert from asset library')}
          onClick={run(() => onOpenAssets(state.world))}
        />
        <CanvasMenuDivider theme={theme} />
        <CanvasMenuSection theme={theme}>
          {t('History & clipboard')}
        </CanvasMenuSection>
        <CanvasMenuButton
          theme={theme}
          icon={<Undo2 className='size-3.5' />}
          label={t('Undo')}
          shortcut={modKey('Z')}
          disabled={!canUndo}
          onClick={run(onUndo)}
        />
        <CanvasMenuButton
          theme={theme}
          icon={<Redo2 className='size-3.5' />}
          label={t('Redo')}
          shortcut={shiftModKey('Z')}
          disabled={!canRedo}
          onClick={run(onRedo)}
        />
        <CanvasMenuButton
          theme={theme}
          icon={<ClipboardPaste className='size-3.5' />}
          label={t('Paste')}
          shortcut={modKey('V')}
          disabled={!canPaste}
          onClick={run(() => onPaste(state.world))}
        />
      </CanvasMenuPanel>
      {submenuOpen && (
        <CanvasMenuPanel
          theme={theme}
          x={submenuX}
          y={state.y}
          width={232}
          onClose={() => setSubmenuOpen(false)}
          ariaLabel={t('Add node')}
        >
          <CanvasCreateList
            theme={theme}
            onCommand={(id) => {
              closeAll()
              onCreateCommand(id, state.world)
            }}
          />
        </CanvasMenuPanel>
      )}
    </>
  )
}
