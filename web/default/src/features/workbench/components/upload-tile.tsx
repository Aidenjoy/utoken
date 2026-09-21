import { Plus, X } from 'lucide-react'
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
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { UPLOAD_MAX_BYTES } from '../constants'
import type { TryOnImage } from '../types'

interface UploadTileProps {
  label: string
  /** Small pill on the right of the header, e.g. "optional". */
  badge?: string
  hint?: string
  max: number
  multiple?: boolean
  value: TryOnImage[]
  onChange: (next: TryOnImage[]) => void
}

function createImageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)), {
      once: true,
    })
    reader.addEventListener('error', () => reject(reader.error), {
      once: true,
    })
    reader.readAsDataURL(file)
  })
}

/**
 * Dashed-grid material uploader shared by every try-on role (reference,
 * garment, detail, model, pose). Files become data URLs so they can travel
 * inside the OpenAI-compatible generation body.
 */
export function UploadTile(props: UploadTileProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const remaining = props.max - props.value.length

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const accepted = [...files].slice(0, Math.max(remaining, 0))
    if (accepted.length < files.length) {
      toast.error(t('Up to {{max}} images per role', { max: props.max }))
    }
    const added: TryOnImage[] = []
    for (const file of accepted) {
      if (!file.type.startsWith('image/')) {
        toast.error(t('Only image files are supported'))
        continue
      }
      if (file.size > UPLOAD_MAX_BYTES) {
        toast.error(t('Image must be smaller than 10 MB'))
        continue
      }
      added.push({
        id: createImageId(),
        src: await readFileAsDataUrl(file),
        name: file.name,
      })
    }
    if (added.length > 0) {
      props.onChange([...props.value, ...added])
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className='border-border rounded-lg border border-dashed p-3'>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{props.label}</span>
        {props.badge ? (
          <span className='border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs'>
            {props.badge}
          </span>
        ) : null}
      </div>
      <div className='flex flex-wrap gap-2'>
        {props.value.map((image, index) => (
          <div
            key={image.id}
            className='group border-border bg-muted relative size-20 overflow-hidden rounded-md border'
          >
            <img
              src={image.src}
              alt={image.name}
              className='size-full object-cover'
            />
            <span className='absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white'>
              {index + 1}
            </span>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t('Remove')}
              className='absolute top-0.5 right-0.5 size-6 bg-black/50 text-white hover:bg-black/70 hover:text-white'
              onClick={() =>
                props.onChange(
                  props.value.filter((item) => item.id !== image.id)
                )
              }
            >
              <X className='size-3.5' />
            </Button>
          </div>
        ))}
        {remaining > 0 ? (
          <button
            type='button'
            className='border-border text-muted-foreground hover:border-primary hover:text-primary flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs'
            onClick={() => inputRef.current?.click()}
          >
            <Plus className='size-4' />
            {props.value.length > 0
              ? t('Continue uploading')
              : t('Upload image')}
          </button>
        ) : null}
      </div>
      {props.hint ? (
        <p className='text-muted-foreground mt-2 text-xs'>{props.hint}</p>
      ) : null}
      <input
        ref={inputRef}
        type='file'
        accept='image/*'
        multiple={props.multiple}
        className='hidden'
        onChange={(event) => void handleFiles(event.target.files)}
      />
    </div>
  )
}
