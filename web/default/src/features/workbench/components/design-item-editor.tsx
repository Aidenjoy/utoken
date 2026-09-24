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
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import {
  createDesignItem,
  moveDesignItem,
  type DesignItem,
} from '../design-types'
import { DesignText, DesignUpload } from './design-controls'

export function DesignItemEditor(props: {
  items: DesignItem[]
  min: number
  max: number
  onChange: (items: DesignItem[]) => void
  quantities?: boolean
  namesRequired?: boolean
  optionalImages?: boolean
  sku?: boolean
}) {
  const { t } = useTranslation()
  const update = (id: string, patch: Partial<DesignItem>) =>
    props.onChange(
      props.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  return (
    <div className='space-y-3'>
      {props.items.map((item, index) => (
        <article
          key={item.id}
          className='border-border space-y-3 rounded-md border p-3'
          aria-label={t('Item {{index}}', { index: index + 1 })}
        >
          <div className='flex items-center justify-between gap-2'>
            <span className='text-muted-foreground text-xs'>
              {t('Item {{index}}', { index: index + 1 })}
            </span>
            {props.max > 1 ? (
              <div className='flex gap-1'>
                <Button
                  type='button'
                  size='icon-sm'
                  variant='ghost'
                  aria-label={t('Move up')}
                  disabled={index === 0}
                  onClick={() =>
                    props.onChange(moveDesignItem(props.items, index, -1))
                  }
                >
                  <ArrowUp className='size-4' />
                </Button>
                <Button
                  type='button'
                  size='icon-sm'
                  variant='ghost'
                  aria-label={t('Move down')}
                  disabled={index === props.items.length - 1}
                  onClick={() =>
                    props.onChange(moveDesignItem(props.items, index, 1))
                  }
                >
                  <ArrowDown className='size-4' />
                </Button>
                <Button
                  type='button'
                  size='icon-sm'
                  variant='ghost'
                  aria-label={t('Delete')}
                  disabled={props.items.length <= props.min}
                  onClick={() =>
                    props.onChange(
                      props.items.filter((entry) => entry.id !== item.id)
                    )
                  }
                >
                  <Trash2 className='size-4' />
                </Button>
              </div>
            ) : null}
          </div>
          <DesignUpload
            label={
              props.optionalImages
                ? 'Item photo (optional)'
                : 'Actual item photo (required)'
            }
            value={item.image}
            onChange={(image) =>
              update(item.id, {
                image,
                name: item.name || image?.name.replace(/\.[^.]+$/, '') || '',
              })
            }
          />
          <DesignText
            label={props.sku ? 'SKU name' : 'Item name'}
            value={item.name}
            required={props.namesRequired}
            onChange={(name) => update(item.id, { name })}
          />
          {props.quantities ? (
            <label className='flex items-center gap-3 text-sm'>
              <span>{t('Quantity (1–4)')}</span>
              <Input
                type='number'
                min={1}
                max={4}
                step={1}
                className='w-20'
                value={item.quantity}
                onChange={(event) =>
                  update(item.id, { quantity: event.target.valueAsNumber })
                }
              />
            </label>
          ) : null}
          <DesignText
            label={props.sku ? 'SKU color and differences' : 'Item notes'}
            multiline
            maxLength={500}
            value={item.notes}
            onChange={(notes) => update(item.id, { notes })}
          />
        </article>
      ))}
      {props.items.length < props.max ? (
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => props.onChange([...props.items, createDesignItem()])}
        >
          <Plus className='size-4' />
          {t('Add item')}
        </Button>
      ) : null}
      <p className='text-muted-foreground text-xs'>
        {t('Use between {{min}} and {{max}} items', {
          min: props.min,
          max: props.max,
        })}
      </p>
    </div>
  )
}
