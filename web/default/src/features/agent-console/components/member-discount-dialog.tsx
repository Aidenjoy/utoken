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
import { useEffect, useMemo, useState } from 'react'
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
import {
  getAgentMemberDiscounts,
  updateAgentMemberDiscounts,
} from '@/features/agents/api'
import type { AgentMember } from '@/features/agents/types'

// 后端把折扣存成 (0,1] 的小数并保留 4 位，UI 以百分比输入/展示（80 → 0.8），
// 与管理员的按模型折扣编辑器共用同一套换算，避免两处出现不同的精度口径。
const MAX_PERCENT = 100
const PERCENT_STEP = 0.1
const RATIO_PRECISION = 10000

interface DiscountRow {
  /** 稳定的行 id，避免用模型名当 key（模型名可切换且可能临时重复） */
  id: string
  model: string
  percent: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: AgentMember | null
  onSuccess?: () => void
}

let rowSeq = 0
function nextRowId(): string {
  rowSeq += 1
  return `member-discount-row-${rowSeq}`
}

function ratioToPercent(ratio: number): string {
  const percent = ratio * 100
  return String(Math.round(percent * 100) / 100)
}

/**
 * Render the billing multiplier the percentage maps to (85 → ×0.85), trimming
 * the floating-point tail so 0.85 never shows up as 0.8500000000000001.
 */
function formatMultiplier(ratio: number): string {
  return String(Math.round(ratio * RATIO_PRECISION) / RATIO_PRECISION)
}

/**
 * Per-member model discount editor, scoped to what this agent may resell.
 *
 * The model picker only offers the agent's authorized models and each one
 * carries its own floor — the deepest discount the admin allowed the agent to
 * grant — so the percentage input is clamped per row rather than globally.
 * Submitting the form sends the complete set of authorized-model discounts:
 * a model dropped here reverts to full price for that member.
 *
 * Discounts an admin set for models outside this agent's authorization are
 * neither listed nor submitted; the server keeps them untouched, so opening
 * this dialog can never silently wipe an admin's configuration.
 */
export function MemberDiscountDialog({
  open,
  onOpenChange,
  member,
  onSuccess,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<DiscountRow[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const memberId = member?.user_id ?? 0
  const { data, isLoading } = useQuery({
    queryKey: ['agent-member-discounts', memberId],
    queryFn: () => getAgentMemberDiscounts(memberId),
    enabled: open && memberId > 0,
  })

  // floors 的键集合就是本代理的授权清单，值是每个模型可给的最低折扣（最深折）。
  const floors = useMemo(() => data?.data?.floors ?? {}, [data])
  const modelOptions = useMemo(
    () =>
      Object.keys(floors)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ value: name, label: name })),
    [floors]
  )

  useEffect(() => {
    if (!open) return
    const discounts = data?.data?.discounts ?? {}
    // 只列授权范围内的折扣：清单外的条目属于管理员配置，代理商无权改也不该看见。
    setRows(
      Object.entries(discounts)
        .filter(([model]) => model in floors)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([model, ratio]) => ({
          id: nextRowId(),
          model,
          percent: ratioToPercent(ratio),
        }))
    )
  }, [open, data, floors])

  const floorPercentOf = (model: string): number | null => {
    const floor = floors[model]
    return typeof floor === 'number' ? floor * MAX_PERCENT : null
  }

  const updateRow = (id: string, patch: Partial<DiscountRow>) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    )
  }

  /**
   * Switching a row's model also re-clamps its percentage: the new model may
   * have a different (usually higher) floor, and leaving the old value in place
   * would just show an error the user has to fix by hand. A value still inside
   * the new range is kept as typed.
   */
  const changeModel = (id: string, model: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row
        const floor = floorPercentOf(model)
        const percent = Number.parseFloat(row.percent)
        if (
          floor == null ||
          !Number.isFinite(percent) ||
          percent < floor ||
          percent > MAX_PERCENT
        ) {
          return {
            ...row,
            model,
            percent:
              floor != null ? ratioToPercent(floor / MAX_PERCENT) : row.percent,
          }
        }
        return { ...row, model }
      })
    )
  }

  const addRow = () => {
    setRows((prev) => [...prev, { id: nextRowId(), model: '', percent: '' }])
  }

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id))
  }

  // 校验：模型必选、不重复、百分比落在 [该模型下限, 100]。与后端
  // common.ValidateModelDiscountsWithinFloors 对齐，但错误就地提示而不是等 400。
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
    const floor = floorPercentOf(model)
    if (floor == null) {
      validationError = t('Model {{name}} is not authorized', { name: model })
      break
    }
    const percent = Number.parseFloat(row.percent)
    if (
      row.percent.trim() === '' ||
      !Number.isFinite(percent) ||
      percent < floor ||
      percent > MAX_PERCENT
    ) {
      validationError = t(
        'Discount for {{name}} must be between {{min}} and {{max}}',
        {
          name: model,
          min: ratioToPercent(floor / MAX_PERCENT),
          max: MAX_PERCENT,
        }
      )
      break
    }
  }
  const isValid = validationError === ''

  const submit = async () => {
    if (!member || !isValid) return
    setIsSubmitting(true)
    try {
      const discounts: Record<string, number> = {}
      for (const row of rows) {
        const percent = Number.parseFloat(row.percent)
        // 百分比 → 小数，按后端精度四舍五入到 4 位，避免 0.8500000000000001 之类的浮点尾巴
        discounts[row.model.trim()] =
          Math.round((percent / MAX_PERCENT) * RATIO_PRECISION) /
          RATIO_PRECISION
      }
      const result = await updateAgentMemberDiscounts(member.user_id, discounts)
      if (!result.success) {
        toast.error(result.message || t('Failed to save discounts'))
        return
      }
      toast.success(t('Discounts saved'))
      onOpenChange(false)
      void queryClient.invalidateQueries({
        queryKey: ['agent-member-discounts', member.user_id],
      })
      void queryClient.invalidateQueries({ queryKey: ['my-agent-members'] })
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
          <DialogTitle>{t('Member Discounts')}</DialogTitle>
          <DialogDescription>
            {t('Member: {{name}}', {
              name: member?.display_name || member?.username || '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='flex items-center justify-between gap-2'>
            <div className='text-muted-foreground text-xs'>
              {t(
                'You can only discount the models you are authorized for, and never below the floor set for each.'
              )}
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='shrink-0'
              disabled={modelOptions.length === 0}
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

          {!isLoading && modelOptions.length === 0 && (
            <div className='border-border/60 bg-muted/20 text-muted-foreground rounded-md border border-dashed py-8 text-center text-sm'>
              {t('No authorized models')}
              <div className='mt-1 text-xs'>
                {t('Ask an administrator to authorize models for you first.')}
              </div>
            </div>
          )}

          {!isLoading && modelOptions.length > 0 && rows.length === 0 && (
            <div className='border-border/60 bg-muted/20 text-muted-foreground rounded-md border border-dashed py-8 text-center text-sm'>
              {t('No model discounts')}
              <div className='mt-1 text-xs'>
                {t('This member is billed at the original price.')}
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
                const floor = floorPercentOf(row.model)
                const percent = Number.parseFloat(row.percent)
                const ratio = Number.isFinite(percent)
                  ? percent / MAX_PERCENT
                  : null
                const isValidPercent =
                  ratio != null &&
                  floor != null &&
                  percent >= floor &&
                  percent <= MAX_PERCENT
                return (
                  <div key={row.id} className='flex items-center gap-2'>
                    <div className='flex-1'>
                      <Combobox
                        options={modelOptions}
                        value={row.model}
                        onValueChange={(value) =>
                          changeModel(row.id, value ?? '')
                        }
                        placeholder={t('Model name')}
                        searchPlaceholder={t('Search a model')}
                        emptyText={t('No matching model')}
                      />
                      {floor != null && (
                        <div className='text-muted-foreground mt-1 pl-1 text-xs'>
                          {t('Floor: {{floor}}%', {
                            floor: ratioToPercent(floor / MAX_PERCENT),
                          })}
                        </div>
                      )}
                    </div>
                    <div className='flex w-28 items-center gap-1'>
                      <Input
                        type='number'
                        min={floor ?? 0}
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
                      {isValidPercent && ratio != null
                        ? `×${formatMultiplier(ratio)}`
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
