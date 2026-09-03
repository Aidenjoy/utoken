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
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import {
  MENTION_KIND_LABEL,
  MENTION_TOKEN_RE,
  type MentionAsset,
} from './mention-utils'

const KIND_ORDER: MentionAsset['kind'][] = [
  'char',
  'prop',
  'scene',
  'shot',
  'video',
]

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// @[kind:id] -> chip HTML；资产缺失时渲染为空
function chipHtml(
  token: string,
  asset: MentionAsset,
  kindLabel: (kind: MentionAsset['kind']) => string
): string {
  const label = `${kindLabel(asset.kind)}·${asset.name}`
  const thumb =
    asset.kind === 'video'
      ? '<span class="mention-chip-icon">▶</span>'
      : `<img class="mention-chip-thumb" src="${escapeHtml(asset.url)}" />`
  return `<span class="mention-chip" contenteditable="false" data-token="${escapeHtml(token)}">${thumb}@${escapeHtml(label)}</span>`
}

// 序列化：chip -> 原始 token，其余为纯文本
function serializeEditor(editor: HTMLElement): string {
  let out = ''
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? '').replaceAll('\u00A0', ' ')
      } else if (child instanceof HTMLElement) {
        if (child.classList.contains('mention-chip')) {
          out += child.dataset.token ?? ''
        } else if (child.nodeName === 'BR') {
          out += '\n'
        } else {
          if (
            out &&
            !out.endsWith('\n') &&
            (child.nodeName === 'DIV' || child.nodeName === 'P')
          ) {
            out += '\n'
          }
          walk(child)
        }
      }
    }
  }
  walk(editor)
  return out.replaceAll(/\n{3,}/g, '\n\n').trim()
}

interface MentionEditorProps {
  value: string
  onChange: (value: string) => void
  assets: MentionAsset[]
  placeholder?: string
  rows?: number
  disabled?: boolean
}

// 提示词编辑器：支持输入 @ 引用资产（渲染为 chip，序列化为 @[kind:id] token）
export function MentionEditor(props: MentionEditorProps) {
  const { t } = useTranslation()
  const editorRef = React.useRef<HTMLDivElement>(null)
  const savedRangeRef = React.useRef<Range | null>(null)
  const valueRef = React.useRef(props.value)
  valueRef.current = props.value

  const [popupOpen, setPopupOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [activeKind, setActiveKind] = React.useState<MentionAsset['kind']>(
    'char'
  )

  const groups = React.useMemo(
    () =>
      KIND_ORDER.map((kind) => ({
        kind,
        label: MENTION_KIND_LABEL[kind],
        items: props.assets.filter((a) => a.kind === kind),
      })).filter((g) => g.items.length > 0),
    [props.assets]
  )

  // 渲染外部值（打开弹窗时避免打断输入）
  const renderValue = React.useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const assetMap = new Map(props.assets.map((a) => [`${a.kind}:${a.id}`, a]))
    const kindLabel = (kind: MentionAsset['kind']) =>
      t(MENTION_KIND_LABEL[kind])
    let html = escapeHtml(valueRef.current || '')
    html = html.replaceAll(MENTION_TOKEN_RE, (token, kind: string, id: string) => {
      const asset = assetMap.get(`${kind}:${id}`)
      if (!asset) return ''
      return chipHtml(token, asset, kindLabel)
    })
    editor.innerHTML = html.split('\n').join('<br>')
  }, [props.assets, t])

  React.useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (serializeEditor(editor) !== (valueRef.current || '')) {
      renderValue()
    }
  }, [props.value, renderValue])

  const emitChange = () => {
    const editor = editorRef.current
    if (!editor) return
    props.onChange(serializeEditor(editor))
  }

  const getCursorTextOffset = (): number => {
    const editor = editorRef.current
    const sel = window.getSelection()
    if (!editor || !sel || sel.rangeCount === 0) return -1
    const range = sel.getRangeAt(0)
    const pre = range.cloneRange()
    pre.selectNodeContents(editor)
    pre.setEnd(range.endContainer, range.endOffset)
    return pre.toString().length
  }

  const closePopup = () => {
    setPopupOpen(false)
    setQuery('')
    savedRangeRef.current = null
  }

  // @ 触发检测：@ 须位于词边界（开头/空白后）
  const checkTrigger = () => {
    const editor = editorRef.current
    if (!editor) return closePopup()
    const text = editor.textContent ?? ''
    const offset = getCursorTextOffset()
    if (offset < 0) return closePopup()
    const before = text.slice(0, offset)
    const match = before.match(/@([^\s@]*)$/)
    if (!match) return closePopup()
    const at = offset - match[0].length
    if (at > 0 && !/[\s\u00A0]/.test(text[at - 1])) return closePopup()
    if (groups.length === 0) return closePopup()
    setQuery(match[1])
    setActiveKind((prev) =>
      groups.some((g) => g.kind === prev) ? prev : groups[0].kind
    )
    setPopupOpen(true)
  }

  const insertMention = (asset: MentionAsset) => {
    const editor = editorRef.current
    const saved = savedRangeRef.current
    if (!editor || !saved) return
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(saved)
    // 删除 @ 及过滤文本后插入 chip（execCommand 保留撤销栈）
    const delLen = query.length + 1
    for (let i = 0; i < delLen; i++) {
      document.execCommand('delete')
    }
    const kindLabel = t(MENTION_KIND_LABEL[asset.kind])
    document.execCommand(
      'insertHTML',
      false,
      `${chipHtml(`@[${asset.kind}:${asset.id}]`, asset, () => kindLabel)}\u00A0`
    )
    closePopup()
    emitChange()
  }

  const handleInput = () => {
    emitChange()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange()
    }
    checkTrigger()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (popupOpen && e.key === 'Escape') {
      e.preventDefault()
      closePopup()
    }
  }

  // 弹窗打开期间：外部点击关闭
  React.useEffect(() => {
    if (!popupOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (editorRef.current && !editorRef.current.contains(target)) {
        closePopup()
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [popupOpen])

  const currentGroup =
    groups.find((g) => g.kind === activeKind) ?? groups[0]
  const filteredItems = React.useMemo(() => {
    const items = currentGroup?.items ?? []
    const q = query.trim()
    return q ? items.filter((i) => i.name.includes(q)) : items
  }, [currentGroup, query])

  return (
    <div className='relative w-full'>
      <div
        ref={editorRef}
        contentEditable={!props.disabled}
        suppressContentEditableWarning
        role='textbox'
        aria-multiline='true'
        data-placeholder={props.placeholder}
        className={cn(
          'border-input bg-background focus-visible:border-ring max-h-80 min-h-20 w-full overflow-y-auto rounded-md border px-3 py-2 text-[13px] leading-5 break-all whitespace-pre-wrap outline-none',
          'empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
          props.disabled &&
            'bg-muted text-muted-foreground cursor-not-allowed opacity-70'
        )}
        style={{ minHeight: `${(props.rows ?? 5) * 20 + 16}px` }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => window.setTimeout(closePopup, 150)}
      />
      <p className='text-muted-foreground mt-1 text-xs'>
        {t('Tip: type space + @ to reference assets')}
      </p>

      {popupOpen && (
        <div className='bg-popover border-border absolute z-50 mt-1 flex max-h-72 w-72 flex-col overflow-hidden rounded-lg border shadow-md'>
          <div className='flex flex-wrap gap-0.5 px-2 pt-2'>
            {groups.map((g) => (
              <button
                key={g.kind}
                type='button'
                className={cn(
                  'rounded px-2 py-1 text-xs transition-colors',
                  activeKind === g.kind
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:bg-accent'
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setActiveKind(g.kind)}
              >
                {t(g.label)}
              </button>
            ))}
          </div>
          <div className='overflow-y-auto p-1.5'>
            {filteredItems.map((item) => (
              <button
                key={`${item.kind}-${item.id}`}
                type='button'
                className='hover:bg-accent flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left'
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(item)}
              >
                {item.kind === 'video' ? (
                  <span className='bg-muted text-primary flex size-8 shrink-0 items-center justify-center rounded'>
                    ▶
                  </span>
                ) : (
                  <img
                    src={item.url}
                    alt=''
                    className='size-8 shrink-0 rounded object-cover'
                  />
                )}
                <span className='truncate text-[13px]'>{item.name}</span>
              </button>
            ))}
            {filteredItems.length === 0 && (
              <div className='text-muted-foreground py-4 text-center text-xs'>
                {t('No available assets in this category')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
