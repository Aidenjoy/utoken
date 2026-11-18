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

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import {
  CANVAS_BACKGROUNDS,
  CANVAS_SIZE_PRESETS,
  DEFAULT_CANVAS_SIZE,
} from '../constants'

// 智能画布：新建 / 重命名对话框

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  maxSide: number
  submitting: boolean
  onCreate: (payload: {
    title: string
    width: number
    height: number
    background: string
  }) => void
}

export function CreateProjectDialog(props: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = React.useState('')
  const [width, setWidth] = React.useState(DEFAULT_CANVAS_SIZE.width)
  const [height, setHeight] = React.useState(DEFAULT_CANVAS_SIZE.height)
  const [background, setBackground] = React.useState(CANVAS_BACKGROUNDS[0])
  const [presetId, setPresetId] = React.useState<string | null>('square')

  React.useEffect(() => {
    if (props.open) {
      setTitle('')
      setWidth(DEFAULT_CANVAS_SIZE.width)
      setHeight(DEFAULT_CANVAS_SIZE.height)
      setBackground(CANVAS_BACKGROUNDS[0])
      setPresetId('square')
    }
  }, [props.open])

  // 与后端 validateCanvasSize 一致：单边上限 + 宽高比 1:16 ~ 16:1
  const error = React.useMemo(() => {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return t('Width and height must be numbers')
    }
    if (width < 16 || height < 16) return t('Canvas must be at least 16x16')
    if (width > props.maxSide || height > props.maxSide) {
      return t('Canvas side must not exceed {{max}}px', { max: props.maxSide })
    }
    const ratio = width / height
    if (ratio > 16 || ratio < 1 / 16) {
      return t('Aspect ratio must stay between 1:16 and 16:1')
    }
    return null
  }, [height, props.maxSide, t, width])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('New canvas')}</DialogTitle>
          <DialogDescription>
            {t(
              'Pick a canvas size; generated images are placed inside this canvas'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-3'>
          <div className='grid gap-1.5'>
            <Label htmlFor='canvas-title'>{t('Title')}</Label>
            <Input
              id='canvas-title'
              value={title}
              placeholder={t('Untitled canvas')}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className='grid gap-1.5'>
            <Label>{t('Size preset')}</Label>
            <div className='flex flex-wrap gap-1.5'>
              {CANVAS_SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  onClick={() => {
                    setPresetId(preset.id)
                    setWidth(preset.width)
                    setHeight(preset.height)
                  }}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs',
                    presetId === preset.id
                      ? 'border-primary bg-primary/10'
                      : 'hover:border-primary/50'
                  )}
                >
                  {preset.label} · {preset.width}×{preset.height}
                </button>
              ))}
            </div>
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='canvas-width'>{t('Width')}</Label>
              <Input
                id='canvas-width'
                inputMode='numeric'
                value={String(width)}
                onChange={(event) => {
                  setPresetId(null)
                  setWidth(Number(event.target.value) || 0)
                }}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='canvas-height'>{t('Height')}</Label>
              <Input
                id='canvas-height'
                inputMode='numeric'
                value={String(height)}
                onChange={(event) => {
                  setPresetId(null)
                  setHeight(Number(event.target.value) || 0)
                }}
              />
            </div>
          </div>

          <div className='grid gap-1.5'>
            <Label>{t('Background')}</Label>
            <div className='flex items-center gap-2'>
              {CANVAS_BACKGROUNDS.map((color) => (
                <button
                  key={color}
                  type='button'
                  title={color}
                  onClick={() => setBackground(color)}
                  style={{ backgroundColor: color }}
                  className={cn(
                    'h-7 w-7 rounded-full border',
                    background === color && 'ring-primary ring-2'
                  )}
                />
              ))}
              <input
                type='color'
                className='border-input h-7 w-10 rounded border bg-transparent'
                value={background}
                onChange={(event) => setBackground(event.target.value)}
              />
            </div>
          </div>

          {error ? <p className='text-destructive text-xs'>{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={Boolean(error) || props.submitting}
            onClick={() =>
              props.onCreate({
                title: title.trim() || t('Untitled canvas'),
                width: Math.round(width),
                height: Math.round(height),
                background,
              })
            }
          >
            {props.submitting ? t('Creating...') : t('Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface RenameProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTitle: string
  submitting: boolean
  onRename: (title: string) => void
}

export function RenameProjectDialog(props: RenameProjectDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = React.useState(props.initialTitle)

  React.useEffect(() => {
    if (props.open) setTitle(props.initialTitle)
  }, [props.open, props.initialTitle])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>{t('Rename canvas')}</DialogTitle>
        </DialogHeader>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('Untitled canvas')}
        />
        <DialogFooter>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={title.trim() === '' || props.submitting}
            onClick={() => props.onRename(title.trim())}
          >
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
