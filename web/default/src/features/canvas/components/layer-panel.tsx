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
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

import type { CanvasDocument, CanvasLayer } from '../types'

// 智能画布：图层面板
// 数组顺序即叠放顺序（末尾在最上层），列表按「最上层在前」展示。

export type LayerReorderDirection = 'up' | 'down' | 'top' | 'bottom'

interface LayerPanelProps {
  doc: CanvasDocument
  selectedId: string | null
  onSelect: (layerId: string) => void
  onPatch: (layerId: string, patch: Partial<CanvasLayer>) => void
  onReorder: (layerId: string, direction: LayerReorderDirection) => void
  onRemove: (layerId: string) => void
}

/** 数值输入：失焦或回车才提交，避免输入过程中反复写历史 */
function NumberField(props: {
  label: string
  value: number
  min?: number
  max?: number
  suffix?: string
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = React.useState(String(round(props.value)))
  React.useEffect(() => {
    setDraft(String(round(props.value)))
  }, [props.value])
  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(round(props.value)))
      return
    }
    let next = parsed
    if (typeof props.min === 'number') next = Math.max(next, props.min)
    if (typeof props.max === 'number') next = Math.min(next, props.max)
    props.onCommit(next)
  }
  return (
    <div className='grid gap-1'>
      <Label className='text-muted-foreground text-xs'>{props.label}</Label>
      <div className='relative'>
        <Input
          className='h-8 pr-7 text-xs'
          inputMode='decimal'
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
        />
        {props.suffix ? (
          <span className='text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px]'>
            {props.suffix}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function LayerPanel(props: LayerPanelProps) {
  const { t } = useTranslation()
  const { doc, selectedId } = props
  const ordered = [...doc.layers].reverse()
  const selected = doc.layers.find((layer) => layer.id === selectedId) ?? null

  if (doc.layers.length === 0) {
    return (
      <div className='text-muted-foreground px-4 py-10 text-center text-sm'>
        {t('No layers yet. Upload an image or add a text layer.')}
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='min-h-0 flex-1 overflow-y-auto px-2 py-2'>
        <ul className='flex flex-col gap-1'>
          {ordered.map((layer) => (
            <li key={layer.id}>
              <div
                role='button'
                tabIndex={0}
                onClick={() => props.onSelect(layer.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    props.onSelect(layer.id)
                  }
                }}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5',
                  layer.id === selectedId
                    ? 'bg-accent border-border'
                    : 'hover:bg-accent/60'
                )}
              >
                <span className='text-muted-foreground shrink-0'>
                  {layer.type === 'image' ? (
                    <ImageIcon size={14} />
                  ) : (
                    <TypeIcon size={14} />
                  )}
                </span>
                <span className='min-w-0 flex-1 truncate text-xs'>
                  {layer.name || layer.id}
                </span>
                <button
                  type='button'
                  className='text-muted-foreground hover:text-foreground shrink-0'
                  title={t('Show / hide')}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onPatch(layer.id, { visible: !layer.visible })
                  }}
                >
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  type='button'
                  className='text-muted-foreground hover:text-foreground shrink-0'
                  title={t('Lock / unlock')}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onPatch(layer.id, { locked: !layer.locked })
                  }}
                >
                  {layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {selected ? (
        <div className='border-t px-3 py-3'>
          <div className='mb-2 flex items-center gap-1'>
            <span className='mr-auto truncate text-xs font-medium'>
              {selected.name || selected.id}
            </span>
            <Button
              size='icon'
              variant='ghost'
              className='h-7 w-7'
              title={t('Move up')}
              onClick={() => props.onReorder(selected.id, 'up')}
            >
              <ChevronUp size={14} />
            </Button>
            <Button
              size='icon'
              variant='ghost'
              className='h-7 w-7'
              title={t('Move down')}
              onClick={() => props.onReorder(selected.id, 'down')}
            >
              <ChevronDown size={14} />
            </Button>
            <Button
              size='icon'
              variant='ghost'
              className='h-7 w-7'
              title={t('Bring to front')}
              onClick={() => props.onReorder(selected.id, 'top')}
            >
              <ArrowUpToLine size={14} />
            </Button>
            <Button
              size='icon'
              variant='ghost'
              className='h-7 w-7'
              title={t('Send to back')}
              onClick={() => props.onReorder(selected.id, 'bottom')}
            >
              <ArrowDownToLine size={14} />
            </Button>
            <Button
              size='icon'
              variant='ghost'
              className='text-destructive h-7 w-7'
              title={t('Delete layer')}
              onClick={() => props.onRemove(selected.id)}
            >
              <Trash2 size={14} />
            </Button>
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <NumberField
              label={t('X')}
              value={selected.x}
              onCommit={(value) => props.onPatch(selected.id, { x: value })}
            />
            <NumberField
              label={t('Y')}
              value={selected.y}
              onCommit={(value) => props.onPatch(selected.id, { y: value })}
            />
            <NumberField
              label={t('Scale')}
              value={selected.scale}
              min={0.02}
              max={20}
              suffix='x'
              onCommit={(value) => props.onPatch(selected.id, { scale: value })}
            />
            <NumberField
              label={t('Rotation')}
              value={selected.rotation}
              min={-180}
              max={180}
              suffix='°'
              onCommit={(value) =>
                props.onPatch(selected.id, { rotation: value })
              }
            />
          </div>

          <div className='mt-3 grid gap-1'>
            <Label className='text-muted-foreground text-xs'>
              {t('Opacity')} · {Math.round(selected.opacity * 100)}%
            </Label>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[selected.opacity]}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === 'number') {
                  props.onPatch(selected.id, { opacity: next })
                }
              }}
            />
          </div>

          {selected.type === 'text' ? (
            <div className='mt-3 grid gap-2'>
              <div className='grid gap-1'>
                <Label className='text-muted-foreground text-xs'>
                  {t('Text')}
                </Label>
                <Input
                  className='h-8 text-xs'
                  value={selected.text ?? ''}
                  onChange={(event) =>
                    props.onPatch(selected.id, { text: event.target.value })
                  }
                />
              </div>
              <div className='grid grid-cols-2 gap-2'>
                <NumberField
                  label={t('Font size')}
                  value={selected.fontSize ?? 32}
                  min={8}
                  max={512}
                  onCommit={(value) =>
                    props.onPatch(selected.id, { fontSize: value })
                  }
                />
                <div className='grid gap-1'>
                  <Label className='text-muted-foreground text-xs'>
                    {t('Color')}
                  </Label>
                  <input
                    type='color'
                    className='border-input h-8 w-full rounded-md border bg-transparent'
                    value={selected.color ?? '#111827'}
                    onChange={(event) =>
                      props.onPatch(selected.id, { color: event.target.value })
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
