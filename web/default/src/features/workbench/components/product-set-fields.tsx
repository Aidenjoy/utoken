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
import { Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

import { PRODUCT_SET_MAX, PRODUCT_SET_TYPES } from '../constants'
import type {
  ProductSetConfig,
  ProductSetShot,
  ProductSetShotType,
} from '../types'
import { UploadTile } from './upload-tile'

interface ProductSetFieldsProps {
  value: ProductSetConfig
  onChange: (updater: (previous: ProductSetConfig) => ProductSetConfig) => void
}

/** 商品套图的上传、内容开关和逐用途出图计划。 */
export function ProductSetFields(props: ProductSetFieldsProps) {
  const { t } = useTranslation()
  const total = props.value.shots.reduce((sum, shot) => sum + shot.count, 0)

  const updateShot = (
    type: ProductSetShotType,
    patch: Partial<ProductSetShot>
  ) => {
    props.onChange((previous) => {
      const current = previous.shots.find((shot) => shot.type === type)
      if (!current) return previous
      const next = { ...current, ...patch }
      if (
        patch.references &&
        current.count > 0 &&
        (patch.references.length > 1 || current.references.length > 1)
      ) {
        next.count = Math.max(1, patch.references.length)
      }
      if (
        patch.count !== undefined &&
        patch.count > 0 &&
        next.references.length > 1
      ) {
        next.count = next.references.length
      }
      const others = previous.shots.reduce(
        (sum, shot) => sum + (shot.type === type ? 0 : shot.count),
        0
      )
      if (next.count < 0 || next.count + others > PRODUCT_SET_MAX) {
        return previous
      }
      return {
        ...previous,
        withScene: previous.withScene || (type === 'scene' && next.count > 0),
        shots: previous.shots.map((shot) => (shot.type === type ? next : shot)),
      }
    })
  }

  return (
    <>
      <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
        <UploadTile
          label={t('Upload product images')}
          badge={`${props.value.products.length}/3`}
          hint={t(
            'Up to 3 images; front, side and packaging shots recommended.'
          )}
          max={3}
          multiple
          value={props.value.products}
          onChange={(products) =>
            props.onChange((previous) => ({ ...previous, products }))
          }
        />
        <UploadTile
          label={t('Scene image')}
          badge={t('Optional')}
          hint={t(
            'Share this background across scene-enabled images. Uploading enables scenes; white background images stay white.'
          )}
          max={1}
          value={props.value.sceneImage ? [props.value.sceneImage] : []}
          onChange={(next) =>
            props.onChange((previous) => ({
              ...previous,
              sceneImage: next[0] ?? null,
              withScene: next.length > 0 || previous.withScene,
            }))
          }
        />
      </section>

      <section className='border-border bg-card rounded-lg border p-4'>
        <FieldSet>
          <FieldLegend>{t('Set content')}</FieldLegend>
          <FieldDescription>
            {t('Combine content options for a complete product image set.')}
          </FieldDescription>
          <FieldGroup className='gap-3'>
            <Field orientation='horizontal' className='rounded-lg border p-3'>
              <Checkbox
                id='product-set-copy'
                checked={props.value.withCopy}
                onCheckedChange={(checked) =>
                  props.onChange((previous) => ({
                    ...previous,
                    withCopy: checked === true,
                  }))
                }
              />
              <FieldContent>
                <FieldLabel htmlFor='product-set-copy'>
                  {t('Selling point copy')}
                </FieldLabel>
                <FieldDescription className='text-xs'>
                  {t('Render selling point text directly on the images.')}
                </FieldDescription>
              </FieldContent>
            </Field>
            <Field orientation='horizontal' className='rounded-lg border p-3'>
              <Checkbox
                id='product-set-content-scene'
                checked={props.value.withScene}
                onCheckedChange={(checked) =>
                  props.onChange((previous) => ({
                    ...previous,
                    withScene: checked === true,
                    shots: previous.shots.map((shot) =>
                      shot.type === 'scene' && !checked
                        ? { ...shot, count: 0 }
                        : shot
                    ),
                  }))
                }
              />
              <FieldContent>
                <FieldLabel htmlFor='product-set-content-scene'>
                  {t('Use scenes')}
                </FieldLabel>
                <FieldDescription className='text-xs'>
                  {t('Place the product in a realistic, suitable environment.')}
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        </FieldSet>
      </section>

      <section className='border-border bg-card @container rounded-lg border p-4'>
        <FieldSet>
          <FieldLegend>{t('Select product set types')}</FieldLegend>
          <FieldDescription className='text-xs'>
            {t(
              'Start with common image types and adapt content to your product. {{count}} selected, up to {{max}}.',
              { count: total, max: PRODUCT_SET_MAX }
            )}
          </FieldDescription>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Multiple references produce one image each; a single reference follows the selected count.'
            )}
          </p>
          <div className='grid gap-3 @min-[28rem]:grid-cols-2'>
            {PRODUCT_SET_TYPES.map((type) => {
              const shot = props.value.shots.find(
                (item) => item.type === type.value
              )
              if (!shot) return null
              const label = t(type.label)
              const selected = shot.count > 0
              const referenceCount = Math.max(1, shot.references.length)
              const remaining = PRODUCT_SET_MAX - total
              const increase =
                shot.references.length > 1 ? referenceCount : shot.count + 1
              return (
                <div
                  key={type.value}
                  className={`min-w-0 rounded-lg border p-3 ${selected ? 'border-primary/50 bg-primary/5' : 'border-border'}`}
                >
                  <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                    <Field orientation='horizontal' className='w-auto'>
                      <Checkbox
                        id={`product-set-${type.value}`}
                        checked={selected}
                        disabled={!selected && referenceCount > remaining}
                        onCheckedChange={(checked) =>
                          updateShot(type.value, {
                            count: checked ? referenceCount : 0,
                          })
                        }
                      />
                      <FieldLabel
                        htmlFor={`product-set-${type.value}`}
                        className='text-sm'
                      >
                        {label}
                      </FieldLabel>
                    </Field>
                    <div className='bg-background flex items-center gap-1 rounded-md border'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='size-7'
                        aria-label={t('Decrease {{type}} count', {
                          type: label,
                        })}
                        disabled={!selected}
                        onClick={() =>
                          updateShot(type.value, {
                            count:
                              shot.references.length > 1 ? 0 : shot.count - 1,
                          })
                        }
                      >
                        <Minus className='size-3.5' />
                      </Button>
                      <output
                        className='min-w-5 text-center text-sm tabular-nums'
                        aria-label={t('{{type}} count', { type: label })}
                      >
                        {shot.count}
                      </output>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='size-7'
                        aria-label={t('Increase {{type}} count', {
                          type: label,
                        })}
                        disabled={
                          increase <= shot.count ||
                          increase - shot.count > remaining
                        }
                        onClick={() =>
                          updateShot(type.value, { count: increase })
                        }
                      >
                        <Plus className='size-3.5' />
                      </Button>
                    </div>
                  </div>
                  <FieldGroup className='grid grid-cols-[5rem_minmax(0,1fr)] gap-2'>
                    <UploadTile
                      compact
                      label={t('Reference images')}
                      max={selected ? remaining + shot.count : PRODUCT_SET_MAX}
                      multiple
                      value={shot.references}
                      onChange={(references) =>
                        updateShot(type.value, { references })
                      }
                    />
                    <Field>
                      <FieldLabel
                        htmlFor={`product-set-note-${type.value}`}
                        className='sr-only'
                      >
                        {t('{{type}} requirements', { type: label })}
                      </FieldLabel>
                      <Textarea
                        id={`product-set-note-${type.value}`}
                        className='h-full min-h-20'
                        rows={2}
                        value={shot.extra}
                        placeholder={t('{{type}} requirements', {
                          type: label,
                        })}
                        onChange={(event) =>
                          updateShot(type.value, { extra: event.target.value })
                        }
                      />
                    </Field>
                    {!selected && (
                      <p className='text-muted-foreground col-span-2 text-xs'>
                        {t(
                          'Not generated this time; references and requirements are kept.'
                        )}
                      </p>
                    )}
                  </FieldGroup>
                </div>
              )
            })}
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='product-set-extra'>
                {t('Requirements for the whole set')}
              </FieldLabel>
              <Textarea
                id='product-set-extra'
                rows={3}
                value={props.value.extra}
                placeholder={t(
                  'e.g. Light backgrounds, clean product edges, visible logo; slogan: Travel light, price: ¥99.'
                )}
                onChange={(event) =>
                  props.onChange((previous) => ({
                    ...previous,
                    extra: event.target.value,
                  }))
                }
              />
            </Field>
          </FieldGroup>
        </FieldSet>
      </section>
    </>
  )
}
