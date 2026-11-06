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
import { Code, Plus, Table, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import type { ChannelModelRouteConfig } from '../types'

type ModelMappingEditorProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  sourceModelOptions?: string[]
  targetModelOptions?: string[]
  routeConfigs?: Record<string, ChannelModelRouteConfig>
  onRouteConfigsChange?: (
    configs: Record<string, ChannelModelRouteConfig>
  ) => void
}

type MappingRow = {
  id: string
  from: string
  to: string
  discount: string
  supports4K: boolean
}

const DUPLICATE_MAPPING_SENTINEL = '{ "duplicate_source_models": '

function getDuplicateSources(rows: MappingRow[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const row of rows) {
    const source = row.from.trim()
    if (!source) continue
    if (seen.has(source)) {
      duplicates.add(source)
    } else {
      seen.add(source)
    }
  }

  return [...duplicates]
}

export function ModelMappingEditor(props: ModelMappingEditorProps) {
  const { t } = useTranslation()
  const sourceListId = useId()
  const targetListId = useId()
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const [rows, setRows] = useState<MappingRow[]>([])
  const [jsonValue, setJsonValue] = useState(props.value)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const nextRowIdRef = useRef(0)
  const duplicateSources = useMemo(() => getDuplicateSources(rows), [rows])
  const showRouteConfigs = Boolean(
    props.routeConfigs && props.onRouteConfigsChange
  )

  const createRowId = () => {
    nextRowIdRef.current += 1
    return `mapping-${nextRowIdRef.current}`
  }

  const routeConfigsFromRows = (
    updatedRows: MappingRow[]
  ): Record<string, ChannelModelRouteConfig> => {
    const configs: Record<string, ChannelModelRouteConfig> = {}
    for (const row of updatedRows) {
      const source = row.from.trim()
      if (!source) continue
      const config: ChannelModelRouteConfig = {
        supports_4k: row.supports4K,
      }
      if (row.discount.trim()) {
        config.discount = Number(row.discount)
      }
      configs[source] = config
    }
    return configs
  }

  const newMappingRow = (from: string, to: string): MappingRow => {
    const config = props.routeConfigs?.[from]
    return {
      id: createRowId(),
      from,
      to,
      discount: config?.discount == null ? '' : String(config.discount),
      supports4K: config?.supports_4k ?? false,
    }
  }

  const parseJsonToRows = (json: string): boolean => {
    try {
      if (!json.trim()) {
        setRows([])
        props.onRouteConfigsChange?.({})
        setJsonError(null)
        return true
      }
      const parsed = JSON.parse(json)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError(t('Model mapping must be a valid JSON object'))
        return false
      }
      const entries = Object.entries(parsed)
      const invalidValue = entries.find(([, to]) => typeof to !== 'string')
      if (invalidValue) {
        setJsonError(t('Model mapping values must be strings'))
        return false
      }
      const remainingRows = [...rows]
      const nextRows = entries.map(([from, to], index) => {
        const toString = String(to)
        const existingIndex = remainingRows.findIndex(
          (row) => row.from === from || rows[index]?.id === row.id
        )
        if (existingIndex >= 0) {
          const [existing] = remainingRows.splice(existingIndex, 1)
          const config = props.routeConfigs?.[from]
          return {
            ...existing,
            from,
            to: toString,
            discount: config?.discount == null ? '' : String(config.discount),
            supports4K: config?.supports_4k ?? false,
          }
        }
        return newMappingRow(from, toString)
      })
      setRows(nextRows)
      props.onRouteConfigsChange?.(routeConfigsFromRows(nextRows))
      setJsonError(null)
      return true
    } catch {
      setJsonError(t('Model mapping must be valid JSON format'))
      return false
    }
  }

  // Parse JSON to rows when value changes externally
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJsonValue(props.value)
    parseJsonToRows(props.value)
    // 仅响应外部 JSON 值变化；解析函数依赖当前行，加入依赖会形成重复同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value])

  const convertRowsToJson = (updatedRows: MappingRow[]): string => {
    if (updatedRows.length === 0) {
      return ''
    }
    const obj: Record<string, string> = {}
    updatedRows.forEach((row) => {
      if (row.from.trim()) {
        obj[row.from.trim()] = row.to.trim()
      }
    })
    return JSON.stringify(obj, null, 2)
  }

  const syncRows = (updatedRows: MappingRow[]) => {
    setRows(updatedRows)
    const duplicates = getDuplicateSources(updatedRows)
    if (duplicates.length > 0) {
      setJsonError(t('Duplicate source model mappings are not allowed'))
      setJsonValue(DUPLICATE_MAPPING_SENTINEL)
      props.onChange(DUPLICATE_MAPPING_SENTINEL)
      return
    }

    const json = convertRowsToJson(updatedRows)
    setJsonError(null)
    setJsonValue(json)
    props.onChange(json)
    props.onRouteConfigsChange?.(routeConfigsFromRows(updatedRows))
  }

  const handleAddRow = () => {
    const newRow: MappingRow = {
      id: createRowId(),
      from: '',
      to: '',
      discount: '',
      supports4K: false,
    }
    syncRows([...rows, newRow])
  }

  const handleDeleteRow = (id: string) => {
    syncRows(rows.filter((row) => row.id !== id))
  }

  const handleRowChange = (
    id: string,
    field: 'from' | 'to',
    newValue: string
  ) => {
    const updatedRows = rows.map((row) =>
      row.id === id ? { ...row, [field]: newValue } : row
    )
    syncRows(updatedRows)
  }

  const handleRouteRowChange = (
    id: string,
    field: 'discount' | 'supports4K',
    newValue: string | boolean
  ) => {
    const updatedRows = rows.map((row) => {
      if (row.id !== id) return row
      return field === 'discount'
        ? { ...row, discount: String(newValue) }
        : { ...row, supports4K: Boolean(newValue) }
    })
    syncRows(updatedRows)
  }

  const handleJsonChange = (newJson: string) => {
    setJsonValue(newJson)
    props.onChange(newJson)
    parseJsonToRows(newJson)
  }

  const handleFillTemplate = () => {
    const template = JSON.stringify(
      { 'gpt-3.5-turbo': 'gpt-3.5-turbo-0125' },
      null,
      2
    )
    setJsonValue(template)
    props.onChange(template)
    parseJsonToRows(template)
  }

  const handleModeChange = (nextMode: string) => {
    if (nextMode !== 'visual' && nextMode !== 'json') return
    if (nextMode === 'json') {
      const duplicates = getDuplicateSources(rows)
      if (duplicates.length === 0) {
        const json = convertRowsToJson(rows)
        setJsonValue(json)
        props.onChange(json)
      }
      setMode('json')
      return
    }
    parseJsonToRows(jsonValue)
    setMode('visual')
  }

  return (
    <div className='space-y-2'>
      <Tabs value={mode} onValueChange={handleModeChange} className='space-y-2'>
        <div className='flex items-center justify-between gap-3'>
          <TabsList>
            <TabsTrigger value='visual'>
              <Table className='h-4 w-4' aria-hidden='true' />
              {t('Visual')}
            </TabsTrigger>
            <TabsTrigger value='json'>
              <Code className='h-4 w-4' aria-hidden='true' />
              {t('JSON')}
            </TabsTrigger>
          </TabsList>
          <Button
            type='button'
            variant='link'
            size='sm'
            className='h-auto p-0'
            onClick={handleFillTemplate}
            disabled={props.disabled}
          >
            {t('Fill Template')}
          </Button>
        </div>

        {jsonError && (
          <Alert variant='destructive'>
            <AlertDescription>{jsonError}</AlertDescription>
          </Alert>
        )}

        {duplicateSources.length > 0 && (
          <Alert>
            <AlertDescription>
              {t('Duplicate source model(s): {{models}}', {
                models: duplicateSources.join(', '),
              })}
            </AlertDescription>
          </Alert>
        )}

        <TabsContent value='visual' className='space-y-2'>
          {rows.length > 0 ? (
            <div className='space-y-2'>
              <div
                className={cn(
                  'grid grid-cols-[1fr_1fr_auto] gap-2 text-sm font-medium',
                  showRouteConfigs &&
                    'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_7rem_2.5rem]'
                )}
              >
                <div>{t('Original Model')}</div>
                <div>{t('Replacement Model')}</div>
                {showRouteConfigs && (
                  <>
                    <div>{t('Discount (0-10)')}</div>
                    <div>{t('Supports 4K')}</div>
                  </>
                )}
                <div className='w-10' />
              </div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    'grid grid-cols-[1fr_1fr_auto] items-center gap-2',
                    showRouteConfigs &&
                      'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_7rem_2.5rem]'
                  )}
                >
                  <Input
                    value={row.from}
                    onChange={(e) =>
                      handleRowChange(row.id, 'from', e.target.value)
                    }
                    placeholder='gpt-3.5-turbo'
                    disabled={props.disabled}
                    list={sourceListId}
                  />
                  <Input
                    value={row.to}
                    onChange={(e) =>
                      handleRowChange(row.id, 'to', e.target.value)
                    }
                    placeholder='gpt-3.5-turbo-0125'
                    disabled={props.disabled}
                    list={targetListId}
                  />
                  {showRouteConfigs && (
                    <>
                      <Input
                        type='number'
                        min={0}
                        max={10}
                        step={0.1}
                        value={row.discount}
                        onChange={(event) =>
                          handleRouteRowChange(
                            row.id,
                            'discount',
                            event.target.value
                          )
                        }
                        placeholder={t('e.g. 8')}
                        disabled={props.disabled}
                        aria-label={t('Discount (0-10)')}
                      />
                      <div className='flex justify-center'>
                        <Checkbox
                          checked={row.supports4K}
                          onCheckedChange={(checked) =>
                            handleRouteRowChange(
                              row.id,
                              'supports4K',
                              checked === true
                            )
                          }
                          disabled={props.disabled}
                          aria-label={t('Supports 4K resolution')}
                        />
                      </div>
                    </>
                  )}
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => handleDeleteRow(row.id)}
                    disabled={props.disabled}
                    className='h-10 w-10'
                    aria-label={t('Delete mapping')}
                  >
                    <Trash2 className='h-4 w-4' aria-hidden='true' />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className='text-muted-foreground flex h-24 items-center justify-center rounded-md border border-dashed text-sm'>
              {t(
                'No model mappings configured. Click "Add Mapping" to get started.'
              )}
            </div>
          )}
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={handleAddRow}
            disabled={props.disabled}
            className='w-full'
          >
            <Plus className='mr-2 h-4 w-4' />
            {t('Add Mapping')}
          </Button>
          {showRouteConfigs && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'Discount uses a 0-10 scale. Leave it blank to exclude the mapping from automatic video Key matching.'
              )}
            </p>
          )}
        </TabsContent>
        <TabsContent value='json'>
          <Textarea
            value={jsonValue}
            onChange={(e) => handleJsonChange(e.target.value)}
            placeholder={t('{"original-model": "replacement-model"}')}
            disabled={props.disabled}
            rows={8}
            className={cn(
              'font-mono text-sm',
              jsonError && 'border-destructive'
            )}
            aria-invalid={Boolean(jsonError)}
          />
        </TabsContent>
      </Tabs>

      {props.sourceModelOptions && props.sourceModelOptions.length > 0 && (
        <datalist id={sourceListId}>
          {props.sourceModelOptions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      )}
      {props.targetModelOptions && props.targetModelOptions.length > 0 && (
        <datalist id={targetListId}>
          {props.targetModelOptions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      )}
    </div>
  )
}
