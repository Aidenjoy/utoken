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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import flatReferencePreview from '@/assets/hero/flat-reference.webp'
import flatSmartPreview from '@/assets/hero/flat-smart.webp'
import threeDReferencePreview from '@/assets/hero/threed-reference.webp'
import threeDSmartPreview from '@/assets/hero/threed-smart.webp'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'

import { GARMENT_BASE_TYPES } from '../constants'
import type { GarmentBaseConfig } from '../types'
import { ChipGroup } from './chip-group'
import { HistoryImagePicker } from './history-image-picker'
import { UploadTile } from './upload-tile'

interface GarmentBaseFieldsProps {
  mode: 'flat' | 'threed'
  config: GarmentBaseConfig
  disabled: boolean
  onChange: (changes: Partial<GarmentBaseConfig>) => void
}

type ImageRole = 'front' | 'supplement' | 'reference'

export function GarmentBaseFields(props: GarmentBaseFieldsProps) {
  const { t } = useTranslation()
  const [historyRole, setHistoryRole] = useState<ImageRole | null>(null)
  const isThreeD = props.mode === 'threed'
  const referenceHint = isThreeD
    ? t('The reference guides 3D style and layout only, not garment identity.')
    : t('A layout reference guides arrangement only, not garment identity.')
  const modes = [
    {
      value: 'smart',
      label: t('Smart generation'),
      description: isThreeD
        ? t('AI automatically creates a 3D garment effect.')
        : t('AI automatically arranges the garment flat.'),
      image: isThreeD ? threeDSmartPreview : flatSmartPreview,
    },
    {
      value: 'reference',
      label: t('Reference image generation'),
      description: isThreeD
        ? t('Follow a reference for a 3D or 2.5D garment effect.')
        : t('Follow a reference image for the flat-lay layout.'),
      image: isThreeD ? threeDReferencePreview : flatReferencePreview,
    },
  ]

  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <h2 className='text-sm font-semibold'>
          {isThreeD
            ? t('Image 1: 3D white background')
            : t('Image 1: Flat-lay white background')}
        </h2>
        <p className='text-muted-foreground text-xs'>
          {t('Generate image 1 first, then use it for detail images.')}
        </p>
      </div>
      {isThreeD ? (
        <p className='border-primary/40 bg-primary/5 rounded-md border-l-2 px-3 py-2 text-xs leading-relaxed'>
          {t(
            'The required front image is the source for the 3D base. The supplementary image is optional.'
          )}
        </p>
      ) : null}
      <div className='grid gap-3 min-[360px]:grid-cols-2'>
        <UploadTile
          label={t('Front garment image')}
          badge={t('Required')}
          hint={t('Click or drag an image here')}
          max={1}
          allowDrop
          disabled={props.disabled}
          value={props.config.front ? [props.config.front] : []}
          onChange={(images) => props.onChange({ front: images[0] ?? null })}
          onSelectHistory={() => setHistoryRole('front')}
        />
        <UploadTile
          label={t('Supplementary image')}
          badge={t('Optional')}
          hint={t('Click or drag an image here')}
          max={1}
          allowDrop
          disabled={props.disabled}
          value={props.config.supplement ? [props.config.supplement] : []}
          onChange={(images) =>
            props.onChange({ supplement: images[0] ?? null })
          }
          onSelectHistory={() => setHistoryRole('supplement')}
        />
      </div>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>
          {t('One front image is enough. A supplementary image is optional.')}
        </p>
        <Dialog>
          <DialogTrigger
            render={
              <Button
                type='button'
                variant='link'
                size='sm'
                disabled={props.disabled}
                className='h-auto p-0 text-xs'
              />
            }
          >
            {t('View upload rules')}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('Upload rules')}</DialogTitle>
              <DialogDescription>
                {t('Use clear images of the same garment.')}
              </DialogDescription>
            </DialogHeader>
            <ul className='list-disc space-y-2 pl-5 text-sm'>
              <li>
                {t('Upload one clear front image showing the entire garment.')}
              </li>
              <li>
                {t(
                  'The optional supplementary image can show fabric or construction details.'
                )}
              </li>
              <li>{t('Each slot accepts one image up to 10 MB.')}</li>
              <li>{referenceHint}</li>
            </ul>
          </DialogContent>
        </Dialog>
      </div>
      <div className='space-y-2'>
        <Label id={`${props.mode}-generation-mode`}>
          {t('Generation method')}
        </Label>
        <RadioGroup
          aria-labelledby={`${props.mode}-generation-mode`}
          className='gap-3 min-[360px]:grid-cols-2'
          value={props.config.generationMode}
          disabled={props.disabled}
          onValueChange={(value) => {
            if (value === 'smart' || value === 'reference') {
              props.onChange({ generationMode: value })
            }
          }}
        >
          {modes.map((mode) => (
            <FieldLabel
              key={mode.value}
              htmlFor={`${props.mode}-mode-${mode.value}`}
              className='border-border has-data-checked:border-primary has-focus-visible:ring-ring w-full cursor-pointer flex-col overflow-hidden rounded-lg border has-focus-visible:ring-2'
            >
              <img
                src={mode.image}
                alt=''
                width={417}
                height={560}
                className='h-36 w-full bg-[#f1f4f3] object-contain sm:h-44'
              />
              <div className='flex items-start gap-2 px-3 pb-3'>
                <RadioGroupItem
                  id={`${props.mode}-mode-${mode.value}`}
                  value={mode.value}
                  className='mt-0.5'
                />
                <div className='min-w-0 space-y-1 break-words'>
                  <span className='block text-sm font-medium'>
                    {mode.label}
                  </span>
                  <span className='text-muted-foreground block text-xs font-normal'>
                    {mode.description}
                  </span>
                </div>
              </div>
            </FieldLabel>
          ))}
        </RadioGroup>
      </div>
      {props.config.generationMode === 'reference' ? (
        <UploadTile
          label={
            isThreeD ? t('3D style reference') : t('Flat-lay layout reference')
          }
          badge={t('Required')}
          hint={referenceHint}
          max={1}
          allowDrop
          disabled={props.disabled}
          value={props.config.reference ? [props.config.reference] : []}
          onChange={(images) =>
            props.onChange({ reference: images[0] ?? null })
          }
          onSelectHistory={() => setHistoryRole('reference')}
        />
      ) : null}
      <div className='space-y-2'>
        <Label htmlFor={`${props.mode}-garment-type`}>
          {t('Uploaded garment type')}
        </Label>
        <Input
          id={`${props.mode}-garment-type`}
          value={props.config.garmentType}
          disabled={props.disabled}
          placeholder={t('Enter or select a garment type')}
          onChange={(event) =>
            props.onChange({ garmentType: event.target.value })
          }
        />
        <ChipGroup
          options={GARMENT_BASE_TYPES.map((type) => ({
            value: t(type),
            label: t(type),
          }))}
          value={props.config.garmentType}
          onChange={(value) => props.onChange({ garmentType: value })}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor={`${props.mode}-note`}>
          {t('Additional requirements (optional)')}
        </Label>
        <Textarea
          id={`${props.mode}-note`}
          rows={3}
          value={props.config.note}
          disabled={props.disabled}
          placeholder={t(
            'e.g. Keep the front print complete and use a light gray background.'
          )}
          onChange={(event) => props.onChange({ note: event.target.value })}
        />
      </div>
      {historyRole && !props.disabled ? (
        <HistoryImagePicker
          onClose={() => setHistoryRole(null)}
          onSelect={(image) => {
            props.onChange({ [historyRole]: image })
            setHistoryRole(null)
          }}
        />
      ) : null}
    </div>
  )
}
