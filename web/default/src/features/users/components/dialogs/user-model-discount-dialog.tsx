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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getPricing } from '@/features/pricing/api'

import { getUserModelDiscounts, updateUserModelDiscounts } from '../../api'

// 后端把折扣存成 (0,1] 的小数并保留 4 位，UI 以百分比输入/展示（80 → 0.8）。
// 步长 0.1% 对应小数 0.001，落在后端精度内。
const MIN_PERCENT = 0.1
const MAX_PERCENT = 100
const PERCENT_STEP = 0.1
const RATIO_PRECISION = 10000

interface DiscountRow {
  /** 稳定的行 id，避免用模型名当 key（模型名可编辑且可能临时重复） */
  id: string
  model: string
  percent: string
}

interface UserModelDiscountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { id: number; username: string; display_name?: string } | null
  onSuccess?: () => void
}

let rowSeq = 0
function nextRowId(): string {
  rowSeq += 1
  return `discount-row-${rowSeq}`
}

function ratioToPercent(ratio: number): string {
  const percent = ratio * 100
  return String(Math.round(percent * 100) / 100)
}

/**
 * Render the billing multiplier the percentage maps to (85 → ×0.85), trimming
 * the floating-point tail so 0.85 never shows up as 0.8500000000000001.
 */
function formatDiscountMultiplier(ratio: number): string {
  return String(Math.round(ratio * RATIO_PRECISION) / RATIO_PRECISION)
}

/**
 * Per-user, per-model discount editor (admin only). Discounts multiply the
 * wallet charge for matching models; subscription deductions and top-up
 * bonuses are never discounted. Keys match the request model name and may end
 * with `*` to match a prefix, longest prefix wins.
 */
export function UserModelDiscountDialog({
  open,
  onOpenChange,
  user,
  onSuccess,
}: UserModelDiscountDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<DiscountRow[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  // 每次打开只铺一次行：模型定价与已存折扣是两个异步查询，若每次数据到达都
  // 重建行，会覆盖管理员在加载间隙已做的编辑。
  const initializedRef = useRef(false)

  const userId = user?.id ?? 0
  const { data, isLoading } = useQuery({
    queryKey: ['user-model-discounts', userId],
    queryFn: () => getUserModelDiscounts(userId),
    enabled: open && userId > 0,
  })

  // 模型名候选来自模型广场的定价缓存（queryKey ['pricing']），允许自由输入以支持 `*` 通配。
  const pricing = useQuery({
    queryKey: ['pricing'],
    queryFn: getPricing,
    staleTime: 5 * 60 * 1000,
    enabled: open,
  })

  const modelOptions = useMemo(
    () =>
      (pricing.data?.data ?? [])
        .map((model) => model.model_name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ value: name, label: name })),
    [pricing.data]
  )

  // 打开即铺满全部模型、默认原价 100%，已存折扣回显覆盖对应行——与代理商端
  // 成员折扣编辑器 / 提升代理商对话框同一口径，管理员只需下调想打折的模型。
  // 行清单 = 定价目录 ∪ 已存折扣键（含 `*` 通配等目录外键）。
  useEffect(() => {
    if (!open) {
      initializedRef.current = false
      setRows([])
      return
    }
    if (initializedRef.current) return
    if (isLoading || pricing.isLoading) return
    const saved = data?.data?.discounts ?? {}
    const catalog = new Set<string>()
    for (const option of modelOptions) catalog.add(option.value)
    for (const key of Object.keys(saved)) catalog.add(key)
    setRows(
      [...catalog]
        .sort((a, b) => a.localeCompare(b))
        .map((model) => {
          const stored = saved[model]
          const savedPercent =
            typeof stored === 'number' && stored > 0 && stored < 1
              ? ratioToPercent(stored)
              : null
          return {
            id: nextRowId(),
            model,
            percent: savedPercent ?? String(MAX_PERCENT),
          }
        })
    )
    initializedRef.current = true
  }, [open, isLoading, pricing.isLoading, data, modelOptions])

  const updateRow = (id: string, patch: Partial<DiscountRow>) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    )
  }

  const addRow = () => {
    setRows((prev) => [...prev, { id: nextRowId(), model: '', percent: '90' }])
  }

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id))
  }

  // 校验：模型名必填、不重复、百分比落在 (0, 100]。与后端 NormalizeModelDiscounts 对齐，
  // 但错误就地提示而不是等 400。
  const seen = new Set<string>()
  let validationError = ''
  for (const row of rows) {
    const model = row.model.trim()
    if (!model) {
      validationError = t('Model name is required')
      break
    }
    if (seen.has(model)) {
      validationError = t('Duplicate model name')
      break
    }
    seen.add(model)
    const percent = Number.parseFloat(row.percent)
    if (
      row.percent.trim() === '' ||
      !Number.isFinite(percent) ||
      percent < MIN_PERCENT ||
      percent > MAX_PERCENT
    ) {
      validationError = t('Discount must be between {{min}} and {{max}}', {
        min: MIN_PERCENT,
        max: MAX_PERCENT,
      })
      break
    }
  }
  const isValid = validationError === ''

  const submit = async () => {
    if (!user || !isValid) return
    setIsSubmitting(true)
    try {
      const discounts: Record<string, number> = {}
      for (const row of rows) {
        const percent = Number.parseFloat(row.percent)
        // 停在原价的行不提交：与代理商端同一约定，缺失键即原价，避免把 1.0
        // 写进 users.model_discounts 造成无意义的整表膨胀。
        if (percent >= MAX_PERCENT) continue
        // 百分比 → 小数，按后端精度四舍五入到 4 位，避免 0.8500000000000001 之类的浮点尾巴
        discounts[row.model.trim()] =
          Math.round((percent / 100) * RATIO_PRECISION) / RATIO_PRECISION
      }
      const result = await updateUserModelDiscounts(user.id, discounts)
      if (!result.success) {
        toast.error(result.message || t('Failed to save discounts'))
        return
      }
      toast.success(t('Discounts saved'))
      onOpenChange(false)
      void queryClient.invalidateQueries({
        queryKey: ['user-model-discounts', user.id],
      })
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      onSuccess?.()
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : t('Failed to save discounts')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>{t('Model Discounts')}</DialogTitle>
          <DialogDescription>
            {t('User: {{name}}', {
              name: user?.display_name || user?.username || '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='flex items-center justify-between gap-2'>
            <div className='text-muted-foreground space-y-1 text-xs'>
              <div>
                {t(
                  'Supports exact model names and prefix wildcards ending with *, e.g. doubao-seedance-*'
                )}
              </div>
              <div>
                {t(
                  'All models start at list price (100%). Lower a row to discount it; rows left at 100% are not saved.'
                )}
              </div>
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='shrink-0'
              onClick={addRow}
            >
              <Plus size={16} />
              {t('Add Model Discount')}
            </Button>
          </div>

          {isLoading && (
            <div className='text-muted-foreground py-8 text-center text-sm'>
              {t('Loading...')}
            </div>
          )}

          {!isLoading && rows.length === 0 && (
            <div className='border-border/60 bg-muted/20 text-muted-foreground rounded-md border border-dashed py-8 text-center text-sm'>
              {t('No model discounts')}
              <div className='mt-1 text-xs'>
                {t('This user is billed at the original price.')}
              </div>
            </div>
          )}

          {!isLoading && rows.length > 0 && (
            <div className='max-h-[320px] space-y-2 overflow-y-auto pr-1'>
              <div className='text-muted-foreground flex items-center gap-2 px-1 text-xs'>
                <span className='flex-1'>{t('Model name')}</span>
                <span className='w-28 text-right'>{t('Discount (%)')}</span>
                <span className='w-16 text-right'>{t('Multiplier')}</span>
                <span className='w-8' />
              </div>
              {rows.map((row) => {
                const percent = Number.parseFloat(row.percent)
                const ratio = Number.isFinite(percent) ? percent / 100 : null
                const isValidPercent = ratio != null && ratio > 0 && ratio <= 1
                return (
                  <div key={row.id} className='flex items-center gap-2'>
                    <div className='flex-1'>
                      <Combobox
                        options={modelOptions}
                        value={row.model}
                        onValueChange={(value) =>
                          updateRow(row.id, { model: value ?? '' })
                        }
                        placeholder={t('Model name')}
                        searchPlaceholder={t('Search or type a model name')}
                        emptyText={t('No matching model')}
                        allowCustomValue
                      />
                    </div>
                    <div className='flex w-28 items-center gap-1'>
                      <Input
                        type='number'
                        min={MIN_PERCENT}
                        max={MAX_PERCENT}
                        step={PERCENT_STEP}
                        value={row.percent}
                        onChange={(event) =>
                          updateRow(row.id, { percent: event.target.value })
                        }
                        className='text-right font-mono'
                        aria-label={t('Discount (%)')}
                      />
                      <span className='text-muted-foreground text-sm'>%</span>
                    </div>
                    <span className='text-muted-foreground w-16 text-right font-mono text-xs tabular-nums'>
                      {isValidPercent
                        ? `×${formatDiscountMultiplier(ratio)}`
                        : '-'}
                    </span>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      className='text-destructive hover:text-destructive shrink-0'
                      onClick={() => removeRow(row.id)}
                      aria-label={t('Delete')}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          <p className='text-muted-foreground text-xs'>
            {t(
              'Discounts apply to wallet billing only. Subscription deductions and top-up bonuses are not discounted.'
            )}
          </p>
          {validationError ? (
            <p className='text-destructive text-xs'>{validationError}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            disabled={isSubmitting || !isValid || isLoading}
            onClick={() => void submit()}
          >
            {isSubmitting ? t('Saving...') : t('Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
