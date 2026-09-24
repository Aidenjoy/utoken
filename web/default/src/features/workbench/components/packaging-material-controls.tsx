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

import { moveDesignItem } from '../design-types'
import {
  changePackagingShape,
  COMPATIBLE_MATERIALS,
  PACKAGING_FINISHES,
  PACKAGING_MATERIALS,
  PACKAGING_SHAPES,
  type PackagingConfig,
  type PackagingMaterial,
  type PackagingShape,
} from '../packaging-config'
import { DesignChoice } from './design-controls'

export function PackagingMaterialControls(props: {
  config: PackagingConfig
  onChange: (patch: Partial<PackagingConfig>) => void
}) {
  const { t } = useTranslation()
  const config = props.config
  const allowed = COMPATIBLE_MATERIALS[config.shape]
  const materials = PACKAGING_MATERIALS.filter((item) =>
    allowed.includes(item.value)
  )
  return (
    <>
      {config.mode !== 'unboxing' ? (
        <DesignChoice
          label='Packaging form'
          options={PACKAGING_SHAPES}
          value={config.shape}
          onChange={(value) =>
            props.onChange(
              changePackagingShape(config, value as PackagingShape)
            )
          }
        />
      ) : null}
      {config.mode === 'materials' ? (
        <div className='space-y-3'>
          {config.combinations.map((item, index) => (
            <div
              key={item.id}
              className='border-border space-y-3 rounded-md border p-3'
            >
              <div className='flex items-center justify-between gap-2'>
                <span className='text-sm'>
                  {t('Material option {{index}}', { index: index + 1 })}
                </span>
                <div className='flex gap-1'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Move up')}
                    disabled={index === 0}
                    onClick={() =>
                      props.onChange({
                        combinations: moveDesignItem(
                          config.combinations,
                          index,
                          -1
                        ),
                      })
                    }
                  >
                    <ArrowUp className='size-4' />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Move down')}
                    disabled={index === config.combinations.length - 1}
                    onClick={() =>
                      props.onChange({
                        combinations: moveDesignItem(
                          config.combinations,
                          index,
                          1
                        ),
                      })
                    }
                  >
                    <ArrowDown className='size-4' />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Delete')}
                    disabled={config.combinations.length <= 2}
                    onClick={() =>
                      props.onChange({
                        combinations: config.combinations.filter(
                          (entry) => entry.id !== item.id
                        ),
                      })
                    }
                  >
                    <Trash2 className='size-4' />
                  </Button>
                </div>
              </div>
              <DesignChoice
                label='Material appearance'
                options={materials}
                value={item.material}
                onChange={(material) =>
                  props.onChange({
                    combinations: config.combinations.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, material: material as PackagingMaterial }
                        : entry
                    ),
                  })
                }
              />
              <DesignChoice
                label='Surface effect'
                options={PACKAGING_FINISHES}
                value={item.finish}
                onChange={(finish) =>
                  props.onChange({
                    combinations: config.combinations.map((entry) =>
                      entry.id === item.id ? { ...entry, finish } : entry
                    ),
                  })
                }
              />
            </div>
          ))}
          {config.combinations.length < 4 ? (
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                const available = materials
                  .flatMap((material) =>
                    PACKAGING_FINISHES.map((finish) => ({
                      material: material.value,
                      finish: finish.value,
                    }))
                  )
                  .find(
                    (candidate) =>
                      !config.combinations.some(
                        (item) =>
                          item.material === candidate.material &&
                          item.finish === candidate.finish
                      )
                  )
                if (!available) return
                props.onChange({
                  combinations: [
                    ...config.combinations,
                    { id: crypto.randomUUID(), ...available },
                  ],
                })
              }}
            >
              <Plus className='size-4' />
              {t('Add material option')}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <DesignChoice
            label='Material appearance'
            options={materials}
            value={config.material}
            onChange={(material) =>
              props.onChange({ material: material as PackagingMaterial })
            }
          />
          <DesignChoice
            label='Surface effect'
            options={PACKAGING_FINISHES}
            value={config.finish}
            onChange={(finish) => props.onChange({ finish })}
          />
        </>
      )}
      <p className='text-muted-foreground text-xs'>
        {t(
          'Appearance only; material safety and manufacturing feasibility are not verified.'
        )}
      </p>
    </>
  )
}
