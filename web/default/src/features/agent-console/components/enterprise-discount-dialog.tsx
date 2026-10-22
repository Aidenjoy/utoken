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
  getMyEnterpriseDiscounts,
  updateMyEnterpriseDiscounts,
} from '@/features/agents/api'
import type { AgentOrganization } from '@/features/agents/types'

// 与成员折扣编辑器共用同一套百分比↔小数换算（80 → 0.8，保留 4 位），
// 避免两处出现不同的精度口径。
const MAX_PERCENT = 100
const PERCENT_STEP = 0.1
const RATIO_PRECISION = 10000

interface DiscountRow {
  model: string
  percent: string
  /** 本行允许的最小百分比 = 授权下限（企业折扣是整表替换，无「只能上调」棘轮）。 */
  minPercent: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  enterprise: AgentOrganization | null
  onSuccess?: () => void
}

function percentOf(ratio: number): number {
  return Math.round(ratio * MAX_PERCENT * 100) / 100
}

function formatMultiplier(ratio: number): string {
  return String(Math.round(ratio * RATIO_PRECISION) / RATIO_PRECISION)
}

/**
 * Per-enterprise model discount editor, scoped to what this agent may resell.
 *
 * Unlike the per-member editor, an enterprise's discounts are a whole-table
 * replacement within the authorization list: a model left at 100% is omitted
 * from the payload and reverts to list price for every member. There is no
 * upward-only ratchet — the agent may deepen or lift an enterprise discount at
 * any time as long as it stays at or above the authorization floor. Saving
 * overwrites every member's personal discounts to match the enterprise.
 */
export function EnterpriseDiscountDialog({
  open,
  onOpenChange,
  enterprise,
  onSuccess,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<DiscountRow[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const orgId = enterprise?.id ?? 0
  const { data, isLoading } = useQuery({
    queryKey: ['agent-enterprise-discounts', orgId],
    queryFn: () => getMyEnterpriseDiscounts(orgId),
    enabled: open && orgId > 0,
  })

  const floors = useMemo(() => data?.data?.floors ?? {}, [data])
  const authorizedCount = useMemo(() => Object.keys(floors).length, [floors])

  useEffect(() => {
    if (!open) return
    const discounts = data?.data?.discounts ?? {}
    setRows(
      Object.keys(floors)
        .sort((a, b) => a.localeCompare(b))
        .map((model) => {
          const minPercent = percentOf(floors[model])
          const saved = discounts[model]
          const savedPercent =
            typeof saved === 'number' && saved < 1 ? percentOf(saved) : 0
          const percent = String(savedPercent > 0 ? savedPercent : MAX_PERCENT)
          return { model, percent, minPercent }
        })
    )
  }, [open, data, floors])

  const updateRow = (model: string, patch: Partial<DiscountRow>) => {
    setRows((prev) =>
      prev.map((row) => (row.model === model ? { ...row, ...patch } : row))
    )
  }

  let validationError = ''
  for (const row of rows) {
    const percent = Number.parseFloat(row.percent)
    if (
      row.percent.trim() === '' ||
      !Number.isFinite(percent) ||
      percent > MAX_PERCENT ||
      percent < row.minPercent
    ) {
      validationError = t(
        'Discount for {{name}} must be between {{min}} and {{max}}',
        { name: row.model, min: row.minPercent, max: MAX_PERCENT }
      )
      break
    }
  }
  const isValid = validationError === ''

  const submit = async () => {
    if (!enterprise || !isValid) return
    setIsSubmitting(true)
    try {
      const discounts: Record<string, number> = {}
      for (const row of rows) {
        const percent = Number.parseFloat(row.percent)
        // 停在原价的行不提交：企业折扣整表替换，未提交即取消该模型折扣。
        if (percent >= MAX_PERCENT) continue
        discounts[row.model] =
          Math.round((percent / MAX_PERCENT) * RATIO_PRECISION) /
          RATIO_PRECISION
      }
      const result = await updateMyEnterpriseDiscounts(enterprise.id, discounts)
      if (!result.success) {
        toast.error(result.message || t('Failed to save discounts'))
        return
      }
      toast.success(t('Discounts saved'))
      onOpenChange(false)
      void queryClient.invalidateQueries({
        queryKey: ['agent-enterprise-discounts', enterprise.id],
      })
      void queryClient.invalidateQueries({ queryKey: ['my-agent-enterprises'] })
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
          <DialogTitle>{t('Enterprise Discounts')}</DialogTitle>
          <DialogDescription>
            {t('Enterprise: {{name}}', {
              name: enterprise?.display_name || enterprise?.name || '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='text-muted-foreground space-y-1 text-xs'>
            <div>
              {t(
                'Models come from your authorization list. Saving overwrites every member discount to match.'
              )}
            </div>
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
                        {t('Floor: {{floor}}%', { floor: row.minPercent })}
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
