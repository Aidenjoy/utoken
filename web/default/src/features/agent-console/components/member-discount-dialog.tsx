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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
  model: string
  /** 当前输入的价格（百分比）；打开弹窗时为已存折扣或授权下限 */
  percent: string
  /** 本行允许的最小百分比：已存折扣（价格只能上调）或授权下限（首次设置） */
  minPercent: number
  /** 管理员给本代理设的授权下限（百分比），仅用于提示文案区分两种下限 */
  floorPercent: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: AgentMember | null
  onSuccess?: () => void
}

/** 折扣小数 → 百分比数值（0.85 → 85），抹掉浮点尾差。 */
function percentOf(ratio: number): number {
  return Math.round(ratio * MAX_PERCENT * 100) / 100
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
 * The row list is the agent's authorization itself — models are not picked or
 * added here — and each row opens at the member's saved price, or at the floor
 * (the deepest discount the admin allowed) when the member has none yet. That
 * opening value is also the row's minimum: prices can only be revised upward,
 * so an agent can never deepen a discount after the fact. The backend enforces
 * the same rule (ValidateModelDiscountsNotLowered); the input min is only the
 * first gate.
 *
 * Submitting sends every authorized model, so the member's price list always
 * mirrors the authorization. Discounts an admin set for models outside this
 * agent's authorization are neither listed nor submitted; the server keeps them
 * untouched, so this dialog can never silently wipe an admin's configuration.
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
  const authorizedCount = useMemo(() => Object.keys(floors).length, [floors])

  useEffect(() => {
    if (!open) return
    const discounts = data?.data?.discounts ?? {}
    // 行清单 = 授权模型自动铺满，不让代理商挑：已存折扣原样回显，没设过的从
    // 授权下限起。两者都是本行之后允许的最小值——价格只能上调。
    setRows(
      Object.keys(floors)
        .sort((a, b) => a.localeCompare(b))
        .map((model) => {
          const floorPercent = percentOf(floors[model])
          const saved = discounts[model]
          const minPercent =
            typeof saved === 'number' ? percentOf(saved) : floorPercent
          return { model, percent: String(minPercent), minPercent, floorPercent }
        })
    )
  }, [open, data, floors])

  const updateRow = (model: string, patch: Partial<DiscountRow>) => {
    setRows((prev) =>
      prev.map((row) => (row.model === model ? { ...row, ...patch } : row))
    )
  }

  // 校验：百分比必须落在 [本行最小值, 100]。本行最小值 = 已存折扣（价格只能
  // 上调）或授权下限（首次设置），与后端 ValidateModelDiscountsWithinFloors /
  // ValidateModelDiscountsNotLowered 对齐，但错误就地提示而不是等 400。
  let validationError = ''
  for (const row of rows) {
    const percent = Number.parseFloat(row.percent)
    if (
      row.percent.trim() === '' ||
      !Number.isFinite(percent) ||
      percent > MAX_PERCENT
    ) {
      validationError = t(
        'Discount for {{name}} must be between {{min}} and {{max}}',
        {
          name: row.model,
          min: row.minPercent,
          max: MAX_PERCENT,
        }
      )
      break
    }
    if (percent < row.minPercent) {
      validationError =
        row.minPercent > row.floorPercent
          ? t('Price for {{name}} can only be raised, lowest {{min}}%', {
              name: row.model,
              min: row.minPercent,
            })
          : t('Discount for {{name}} must be between {{min}} and {{max}}', {
              name: row.model,
              min: row.minPercent,
              max: MAX_PERCENT,
            })
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
        discounts[row.model] =
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
          <div className='text-muted-foreground text-xs'>
            {t(
              'Models come from your authorization list. You can only adjust the price, and only upward.'
            )}
          </div>

          {isLoading && (
            <div className='text-muted-foreground py-8 text-center text-sm'>
              {t('Loading...')}
            </div>
          )}

          {!isLoading && authorizedCount === 0 && (
            <div className='border-border/60 bg-muted/20 text-muted-foreground rounded-md border border-dashed py-8 text-center text-sm'>
              {t('No authorized models')}
              <div className='mt-1 text-xs'>
                {t('Ask an administrator to authorize models for you first.')}
              </div>
            </div>
          )}

          {!isLoading && rows.length > 0 && (
            <div className='max-h-[320px] space-y-2 overflow-y-auto pr-1'>
              <div className='text-muted-foreground flex items-center gap-2 px-1 text-xs'>
                <span className='flex-1'>{t('Model name')}</span>
                <span className='w-28 text-right'>{t('Discount (%)')}</span>
                <span className='w-16 text-right'>{t('Multiplier')}</span>
              </div>
              {rows.map((row) => {
                const percent = Number.parseFloat(row.percent)
                const ratio = Number.isFinite(percent)
                  ? percent / MAX_PERCENT
                  : null
                const isValidPercent =
                  ratio != null &&
                  percent >= row.minPercent &&
                  percent <= MAX_PERCENT
                return (
                  <div key={row.model} className='flex items-center gap-2'>
                    <div className='min-w-0 flex-1'>
                      <span className='font-mono text-sm'>{row.model}</span>
                      <div className='text-muted-foreground mt-1 pl-1 text-xs'>
                        {row.minPercent > row.floorPercent
                          ? t('Can only be raised from {{min}}%', {
                              min: row.minPercent,
                            })
                          : t('Floor: {{floor}}%', {
                              floor: row.floorPercent,
                            })}
                      </div>
                    </div>
                    <div className='flex w-28 items-center gap-1'>
                      <Input
                        type='number'
                        min={row.minPercent}
                        max={MAX_PERCENT}
                        step={PERCENT_STEP}
                        value={row.percent}
                        onChange={(event) =>
                          updateRow(row.model, { percent: event.target.value })
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
