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
import { AlertTriangle, Brush, Eraser, Images, Loader2, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { proxyImageUrl } from '../api'
import {
  ASPECT_OPTIONS,
  CANVAS_TOOL_GROUPS,
  MASK_BRUSH_SIZES,
  OUTPAINT_MODES,
} from '../constants'
import type {
  CanvasAsset,
  CanvasLayer,
  CapabilitiesResponse,
  ToolCapability,
  ToolParam,
} from '../types'

// 智能画布：工具面板
// 工具清单、参数、限制、可用性全部来自后端 /capabilities，
// 前端不硬编码模型能力，也不猜测缺失的官方限制。

export type ToolParamValues = Record<string, string | number | boolean>

interface ToolPanelProps {
  capabilities?: CapabilitiesResponse
  capabilitiesLoading: boolean
  capabilitiesError: string | null
  activeTool: string | null
  onToolChange: (tool: string) => void
  params: ToolParamValues
  onParamsChange: (patch: ToolParamValues) => void
  prompt: string
  onPromptChange: (value: string) => void
  sourceLayer: CanvasLayer | null
  extraRefs: CanvasAsset[]
  onPickRefs: () => void
  onRemoveRef: (refId: string) => void
  maskReady: boolean
  brushSize: number
  onBrushSizeChange: (size: number) => void
  onStartMask: (mode: 'mask-brush' | 'mask-rect') => void
  onClearMask: () => void
  onSubmit: () => void
  submitting: boolean
}

const ENUM_LABEL_KEYS: Record<string, string> = {
  general: 'General',
  human: 'Human portrait',
  product: 'Product',
  standard: 'Standard',
  professional: 'Professional',
  max: 'Generative model',
  generative_first: 'Generative first',
  ratio: 'Scale ratio',
  aspect: 'Target aspect ratio',
  edges: 'Four edges',
  canvas: 'Custom canvas',
}

/** 扩图按方式过滤参数：只展示当前方式真正会下发的字段 */
function visibleParams(
  tool: ToolCapability,
  params: ToolParamValues
): ToolParam[] {
  if (tool.tool !== 'outpaint') return tool.params
  const mode = String(params.mode ?? 'ratio')
  const byMode: Record<string, string[]> = {
    ratio: ['mode', 'ratio'],
    aspect: ['mode', 'targetAspect'],
    edges: ['mode', 'top', 'bottom', 'left', 'right'],
    canvas: ['mode', 'targetWidth', 'targetHeight'],
  }
  const allowed = byMode[mode] ?? ['mode']
  return tool.params.filter((param) => allowed.includes(param.name))
}

function ParamField(props: {
  param: ToolParam
  value: string | number | boolean | undefined
  onChange: (value: string | number | boolean) => void
}) {
  const { t } = useTranslation()
  const { param, value } = props
  const label = ENUM_LABEL_KEYS[param.name]
    ? t(ENUM_LABEL_KEYS[param.name] as string)
    : param.label

  if (param.type === 'bool') {
    return (
      <div className='flex items-center justify-between gap-2'>
        <Label className='text-xs'>{label}</Label>
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(checked) => props.onChange(Boolean(checked))}
        />
      </div>
    )
  }

  if (param.type === 'enum') {
    const options = param.enum ?? []
    return (
      <div className='grid gap-1'>
        <Label className='text-xs'>{label}</Label>
        <Select
          value={String(value ?? param.default ?? options[0] ?? '')}
          onValueChange={(next) => {
            if (next !== null) props.onChange(next)
          }}
        >
          <SelectTrigger className='h-8 w-full text-xs'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {ENUM_LABEL_KEYS[option]
                  ? t(ENUM_LABEL_KEYS[option] as string)
                  : option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (param.name === 'targetAspect') {
    return (
      <div className='grid gap-1'>
        <Label className='text-xs'>{label}</Label>
        <Select
          value={String(value ?? param.default ?? '1:1')}
          onValueChange={(next) => {
            if (next !== null) props.onChange(next)
          }}
        >
          <SelectTrigger className='h-8 w-full text-xs'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {ASPECT_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const numeric = param.type === 'int' || param.type === 'float'
  return (
    <div className='grid gap-1'>
      <Label className='text-xs'>
        {label}
        {numeric && (param.min !== undefined || param.max !== undefined) ? (
          <span className='text-muted-foreground ml-1 font-normal'>
            ({param.min ?? '-'} ~ {param.max ?? '-'})
          </span>
        ) : null}
      </Label>
      <Input
        className='h-8 text-xs'
        inputMode={numeric ? 'decimal' : 'text'}
        value={value === undefined || value === null ? '' : String(value)}
        placeholder={param.default === undefined ? '' : String(param.default)}
        onChange={(event) => {
          const raw = event.target.value
          if (!numeric) {
            props.onChange(raw)
            return
          }
          if (raw.trim() === '') {
            props.onChange('')
            return
          }
          const parsed = Number(raw)
          props.onChange(Number.isFinite(parsed) ? parsed : '')
        }}
      />
      {param.help ? (
        <span className='text-muted-foreground text-[11px]'>{param.help}</span>
      ) : null}
    </div>
  )
}

export function ToolPanel(props: ToolPanelProps) {
  const { t } = useTranslation()
  const tools = props.capabilities?.tools
  const byTool = React.useMemo(() => {
    const map = new Map<string, ToolCapability>()
    ;(tools ?? []).forEach((tool) => map.set(tool.tool, tool))
    return map
  }, [tools])

  const active = props.activeTool
    ? (byTool.get(props.activeTool) ?? null)
    : null
  const sourceLayer = props.sourceLayer
  const sourceIsImage = sourceLayer?.type === 'image'

  // 提交前置校验：把后端会拒绝的情况提前在按钮上说明，避免无谓的真实调用
  const blockReason = React.useMemo(() => {
    if (!active) return t('Select a tool first')
    if (!active.available) {
      return active.unavailableReason || t('This tool is currently unavailable')
    }
    if (active.requiresImage && !sourceIsImage) {
      return t('Select an image layer on the canvas first')
    }
    if (active.requiresPrompt && props.prompt.trim() === '') {
      return t('Prompt is required')
    }
    if (active.supportsMask === 'required' && !props.maskReady) {
      return t('Paint the mask area before submitting')
    }
    if (active.tool === 'image_ref_multi') {
      const count = 1 + props.extraRefs.length
      const min = active.limits.minMultiRefImages ?? active.minImages ?? 2
      if (count < min) {
        return t('Multi-reference needs at least {{count}} images', {
          count: min,
        })
      }
    }
    return null
  }, [
    active,
    props.extraRefs.length,
    props.maskReady,
    props.prompt,
    sourceIsImage,
    t,
  ])

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='min-h-0 flex-1 overflow-y-auto px-3 py-3'>
        {props.capabilitiesLoading ? (
          <div className='text-muted-foreground flex items-center gap-2 py-6 text-sm'>
            <Loader2 className='animate-spin' size={16} />
            {t('Loading tool capabilities...')}
          </div>
        ) : null}

        {props.capabilitiesError ? (
          <div className='border-destructive/40 bg-destructive/5 text-destructive mb-3 rounded-md border px-3 py-2 text-xs'>
            {props.capabilitiesError}
          </div>
        ) : null}

        <div className='flex flex-col gap-3'>
          {CANVAS_TOOL_GROUPS.map((group) => {
            const groupTools = group.tools
              .map((name) => byTool.get(name))
              .filter((tool): tool is ToolCapability => Boolean(tool))
            if (groupTools.length === 0) return null
            return (
              <div key={group.id} className='grid gap-1.5'>
                <span className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
                  {t(group.title)}
                </span>
                <div className='grid grid-cols-2 gap-1.5'>
                  {groupTools.map((tool) => (
                    <button
                      key={tool.tool}
                      type='button'
                      onClick={() => props.onToolChange(tool.tool)}
                      className={cn(
                        'relative rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                        props.activeTool === tool.tool
                          ? 'border-primary bg-primary/5'
                          : 'hover:border-primary/50',
                        !tool.available && 'opacity-60'
                      )}
                    >
                      <span className='block truncate font-medium'>
                        {tool.label}
                      </span>
                      <span className='text-muted-foreground block truncate text-[11px]'>
                        {t(
                          tool.upstream === 'ark'
                            ? 'Image model'
                            : 'Media toolkit'
                        )}
                      </span>
                      {!tool.available ? (
                        <AlertTriangle
                          size={12}
                          className='absolute top-1.5 right-1.5 text-amber-500'
                        />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {active ? (
          <div className='mt-4 border-t pt-3'>
            <div className='mb-2 flex items-baseline justify-between gap-2'>
              <span className='text-sm font-medium'>{active.label}</span>
              <span className='text-muted-foreground text-[11px]'>
                {t('{{n}} points/image', { n: active.unitPrice })}
              </span>
            </div>
            <p className='text-muted-foreground mb-3 text-xs'>
              {active.description}
            </p>

            {!active.available ? (
              <div className='mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400'>
                <div className='mb-1 flex items-center gap-1 font-medium'>
                  <AlertTriangle size={13} />
                  {t('Tool unavailable')}
                </div>
                {active.unavailableReason ||
                  t('Reason not provided by the backend')}
              </div>
            ) : (
              <>
                <div className='text-muted-foreground mb-3 grid gap-1 text-[11px]'>
                  {active.model ? (
                    <div>
                      {t('Model')}:{' '}
                      <span className='text-foreground'>{active.model}</span>
                    </div>
                  ) : null}
                  {active.channelName ? (
                    <div>
                      {t('Channel')}: {active.channelName}
                      {active.channelId ? ` (#${active.channelId})` : ''}
                    </div>
                  ) : null}
                  <div>
                    {t('Reference images')}: {active.minImages} ~{' '}
                    {active.maxImages}
                  </div>
                  {active.limits.maxSidePixels ? (
                    <div>
                      {t('Max side')}: {active.limits.maxSidePixels}px
                    </div>
                  ) : null}
                  <div>
                    {t('Cancellable')}: {active.cancelable ? t('Yes') : t('No')}
                  </div>
                </div>

                {active.requiresPrompt ? (
                  <div className='mb-3 grid gap-1'>
                    <Label className='text-xs'>{t('Prompt')}</Label>
                    <Textarea
                      className='min-h-[76px] text-xs'
                      value={props.prompt}
                      placeholder={t(
                        'Describe what you want to generate or change'
                      )}
                      onChange={(event) =>
                        props.onPromptChange(event.target.value)
                      }
                    />
                    <span className='text-muted-foreground text-[11px]'>
                      {props.prompt.length} / {active.limits.maxPromptRunes}
                    </span>
                  </div>
                ) : null}

                {active.requiresImage ? (
                  <div className='mb-3 grid gap-1'>
                    <Label className='text-xs'>{t('Source image')}</Label>
                    <div className='flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs'>
                      {sourceIsImage && sourceLayer?.url ? (
                        <>
                          <img
                            src={proxyImageUrl(sourceLayer.url)}
                            alt={sourceLayer.name}
                            className='bg-muted h-8 w-8 rounded object-cover'
                          />
                          <span className='min-w-0 flex-1 truncate'>
                            {sourceLayer.name}
                          </span>
                          <span className='text-muted-foreground text-[11px]'>
                            {Math.round(sourceLayer.width * sourceLayer.scale)}×
                            {Math.round(sourceLayer.height * sourceLayer.scale)}
                          </span>
                        </>
                      ) : (
                        <span className='text-muted-foreground'>
                          {t('Select an image layer on the canvas first')}
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}

                {active.maxImages > 1 ? (
                  <div className='mb-3 grid gap-1'>
                    <Label className='text-xs'>
                      {t('Extra reference images')}
                    </Label>
                    <div className='flex flex-wrap items-center gap-1.5'>
                      {props.extraRefs.map((asset) => (
                        <span
                          key={asset.refId}
                          className='bg-muted/60 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px]'
                        >
                          <img
                            src={proxyImageUrl(asset.url)}
                            alt={asset.name}
                            className='h-5 w-5 rounded object-cover'
                          />
                          <span className='max-w-[90px] truncate'>
                            {asset.name || asset.refId}
                          </span>
                          <button
                            type='button'
                            className='text-muted-foreground hover:text-foreground'
                            onClick={() => props.onRemoveRef(asset.refId)}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                      <Button
                        size='sm'
                        variant='outline'
                        className='h-7 gap-1 px-2 text-[11px]'
                        onClick={props.onPickRefs}
                        disabled={
                          1 + props.extraRefs.length >= active.maxImages
                        }
                      >
                        <Images size={12} />
                        {t('From library')}
                      </Button>
                    </div>
                    <span className='text-muted-foreground text-[11px]'>
                      {t('{{count}} selected, up to {{max}}', {
                        count: 1 + props.extraRefs.length,
                        max: active.maxImages,
                      })}
                    </span>
                  </div>
                ) : null}

                {active.supportsMask !== 'none' ? (
                  <div className='mb-3 grid gap-2 rounded-md border px-2 py-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <Label className='text-xs'>{t('Mask')}</Label>
                      <span
                        className={cn(
                          'text-[11px]',
                          props.maskReady
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground'
                        )}
                      >
                        {props.maskReady ? t('Mask ready') : t('Mask empty')}
                      </span>
                    </div>
                    {active.maskHint ? (
                      <p className='text-muted-foreground text-[11px]'>
                        {active.maskHint}
                      </p>
                    ) : null}
                    <div className='flex flex-wrap items-center gap-1.5'>
                      <Button
                        size='sm'
                        variant='outline'
                        className='h-7 gap-1 px-2 text-[11px]'
                        onClick={() => props.onStartMask('mask-brush')}
                      >
                        <Brush size={12} />
                        {t('Brush')}
                      </Button>
                      <Button
                        size='sm'
                        variant='outline'
                        className='h-7 gap-1 px-2 text-[11px]'
                        onClick={() => props.onStartMask('mask-rect')}
                      >
                        {t('Rect select')}
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        className='h-7 gap-1 px-2 text-[11px]'
                        onClick={props.onClearMask}
                      >
                        <Eraser size={12} />
                        {t('Clear mask')}
                      </Button>
                    </div>
                    <div className='flex items-center gap-1.5'>
                      <span className='text-muted-foreground text-[11px]'>
                        {t('Brush size')}
                      </span>
                      {MASK_BRUSH_SIZES.map((size) => (
                        <button
                          key={size}
                          type='button'
                          onClick={() => props.onBrushSizeChange(size)}
                          className={cn(
                            'h-6 min-w-6 rounded border px-1 text-[11px]',
                            props.brushSize === size
                              ? 'border-primary bg-primary/10'
                              : 'hover:border-primary/50'
                          )}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                    <p className='text-muted-foreground text-[11px]'>
                      {t(
                        'The mask is stored at the original pixel size of the source image'
                      )}
                    </p>
                  </div>
                ) : null}

                <div className='grid gap-2'>
                  {visibleParams(active, props.params).map((param) => (
                    <ParamField
                      key={param.name}
                      param={param}
                      value={props.params[param.name]}
                      onChange={(value) =>
                        props.onParamsChange({ [param.name]: value })
                      }
                    />
                  ))}
                  {active.tool === 'outpaint' ? (
                    <div className='flex items-center gap-1.5'>
                      {OUTPAINT_MODES.map((mode) => (
                        <button
                          key={mode}
                          type='button'
                          onClick={() => props.onParamsChange({ mode })}
                          className={cn(
                            'h-7 flex-1 rounded border px-1 text-[11px]',
                            String(props.params.mode ?? 'ratio') === mode
                              ? 'border-primary bg-primary/10'
                              : 'hover:border-primary/50'
                          )}
                        >
                          {t(ENUM_LABEL_KEYS[mode] as string)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className='border-t px-3 py-2'>
        {blockReason ? (
          <p className='text-muted-foreground mb-1.5 text-[11px]'>
            {blockReason}
          </p>
        ) : null}
        <Button
          className='w-full'
          disabled={Boolean(blockReason) || props.submitting}
          onClick={props.onSubmit}
        >
          {props.submitting ? (
            <>
              <Loader2 className='mr-1 animate-spin' size={14} />
              {t('Submitting...')}
            </>
          ) : (
            t('Submit task')
          )}
        </Button>
      </div>
    </div>
  )
}
