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
import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getPricing } from '@/features/pricing/api'
import { searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'

import { createAgent, updateAgent } from '../api'
import { AGENT_STATUS, type Agent } from '../types'

type Props = {
  open: boolean
  agent: Agent | null
  onOpenChange: (open: boolean) => void
}

// 后端把折扣存成 (0,1] 的小数并保留 4 位，UI 以百分比输入/展示（80 → 0.8）。
// 与管理员的按模型折扣编辑器共用同一套换算，避免两处出现不同的精度口径。
const MIN_PERCENT = 0.1
const MAX_PERCENT = 100
const PERCENT_STEP = 0.1
const RATIO_PRECISION = 10000
const DEFAULT_FLOOR_PERCENT = '80'

interface AuthorizationRow {
  /** 稳定的行 id，避免用模型名当 key（模型名可编辑且可能临时重复） */
  id: string
  model: string
  percent: string
}

let rowSeq = 0
function nextRowId(): string {
  rowSeq += 1
  return `agent-auth-row-${rowSeq}`
}

function ratioToPercent(ratio: number): string {
  const percent = ratio * 100
  return String(Math.round(percent * 100) / 100)
}

/**
 * Render the billing multiplier a floor percentage maps to (80 → ×0.8),
 * trimming the floating-point tail so 0.85 never shows as 0.8500000000000001.
 */
function formatMultiplier(ratio: number): string {
  return String(Math.round(ratio * RATIO_PRECISION) / RATIO_PRECISION)
}

/**
 * Promote a registered user to reseller (create) or edit an existing reseller's
 * model authorization / status / remark.
 *
 * Each row authorizes one exact model and sets the deepest discount the agent
 * may grant for it: a floor of 80% lets the agent price that model anywhere in
 * [80%, 100%] for each of their members. The authorized model list doubles as
 * the allowlist for every user bound to the agent — models left out simply
 * cannot be called by those users, so at least one row is required.
 *
 * Model names are picked from the pricing list rather than typed: wildcards
 * would over-authorize (a prefix match silently covers models the admin never
 * reviewed), and the picker keeps the list in sync with what is actually
 * served.
 */
export function SetAgentDialog({ open, agent, onOpenChange }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = agent !== null

  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<User | null>(null)
  const [rows, setRows] = useState<AuthorizationRow[]>([])
  const [status, setStatus] = useState<number>(AGENT_STATUS.ENABLED)
  const [remark, setRemark] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 模型候选来自模型广场的定价缓存（queryKey ['pricing']），与按模型折扣编辑器一致。
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

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setKeyword('')
    setResults([])
    if (agent) {
      setStatus(agent.status)
      setRemark(agent.remark ?? '')
      setRows(
        Object.entries(agent.model_discounts ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([model, ratio]) => ({
            id: nextRowId(),
            model,
            percent: ratioToPercent(ratio),
          }))
      )
    } else {
      setStatus(AGENT_STATUS.ENABLED)
      setRemark('')
      // 新建时给一行空白：授权清单不允许为空，先摆一行引导填写。
      setRows([{ id: nextRowId(), model: '', percent: DEFAULT_FLOOR_PERCENT }])
    }
  }, [open, agent])

  // Debounced user search (create mode only).
  useEffect(() => {
    if (isEdit || !open) return
    const kw = keyword.trim()
    if (kw === '') {
      setResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      const res = await searchUsers({ keyword: kw, p: 1, page_size: 10 })
      if (cancelled) return
      setResults(res.success ? (res.data?.items ?? []) : [])
      setSearching(false)
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [keyword, isEdit, open])

  const updateRow = (id: string, patch: Partial<AuthorizationRow>) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    )
  }

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: nextRowId(), model: '', percent: DEFAULT_FLOOR_PERCENT },
    ])
  }

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id))
  }

  // 校验与后端 common.NormalizeAgentModelFloors 对齐，但错误就地提示而不是等 400。
  const seen = new Set<string>()
  let validationError = ''
  if (rows.length === 0) {
    validationError = t('Authorize at least one model')
  }
  for (const row of rows) {
    if (validationError) break
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
  const canSubmit = isValid && (isEdit || selected !== null)

  const submit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const modelDiscounts: Record<string, number> = {}
      for (const row of rows) {
        const percent = Number.parseFloat(row.percent)
        // 百分比 → 小数，按后端精度四舍五入到 4 位，避免 0.8500000000000001 之类的浮点尾巴
        modelDiscounts[row.model.trim()] =
          Math.round((percent / 100) * RATIO_PRECISION) / RATIO_PRECISION
      }
      if (isEdit && agent) {
        const res = await updateAgent(agent.id, {
          model_discounts: modelDiscounts,
          status,
          remark: remark.trim(),
        })
        if (!res.success) {
          toast.error(res.message || t('Failed to save'))
          return
        }
        toast.success(t('Agent updated'))
      } else if (selected) {
        const res = await createAgent({
          user_id: selected.id,
          model_discounts: modelDiscounts,
          remark: remark.trim(),
        })
        if (!res.success) {
          toast.error(res.message || t('Failed to create'))
          return
        }
        toast.success(t('Agent created'))
      }
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['agents'] })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('Edit Agent') : t('Promote User to Agent')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Pick the models this agent may resell and the deepest discount allowed for each. Members can only call these models.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {isEdit ? (
            <div className='space-y-2'>
              <Label>{t('User')}</Label>
              <div className='bg-muted/50 rounded-md px-3 py-2 text-sm'>
                {agent?.display_name || agent?.username || '-'}
                {agent?.email ? (
                  <span className='text-muted-foreground ml-2 text-xs'>
                    {agent.email}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className='space-y-2'>
              <Label>{t('User')}</Label>
              {selected ? (
                <div className='bg-muted/50 flex items-center justify-between rounded-md px-3 py-2 text-sm'>
                  <span>
                    {selected.display_name || selected.username}
                    {selected.email ? (
                      <span className='text-muted-foreground ml-2 text-xs'>
                        {selected.email}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => {
                      setSelected(null)
                      setKeyword('')
                    }}
                  >
                    {t('Change')}
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder={t('Search by username or email...')}
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                  />
                  {searching ? (
                    <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                      <Loader2 className='h-3 w-3 animate-spin' />
                      {t('Searching...')}
                    </div>
                  ) : null}
                  {results.length > 0 ? (
                    <ul className='border-input max-h-[160px] overflow-y-auto rounded-md border'>
                      {results.map((user) => (
                        <li key={user.id}>
                          <button
                            type='button'
                            className='hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm'
                            onClick={() => {
                              setSelected(user)
                              setResults([])
                              setKeyword('')
                            }}
                          >
                            <Check className='size-4 shrink-0 opacity-0' />
                            <span className='truncate'>
                              {user.display_name || user.username}
                              {user.email ? (
                                <span className='text-muted-foreground ml-2 text-xs'>
                                  {user.email}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </div>
          )}

          <div className='space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <Label>{t('Authorized Models')}</Label>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='shrink-0'
                onClick={addRow}
              >
                <Plus size={16} />
                {t('Add Model')}
              </Button>
            </div>

            {rows.length === 0 ? (
              <div className='border-border/60 bg-muted/20 text-muted-foreground rounded-md border border-dashed py-6 text-center text-sm'>
                {t('No authorized models')}
                <div className='mt-1 text-xs'>
                  {t('The agent cannot resell anything until you add one.')}
                </div>
              </div>
            ) : (
              <div className='max-h-[280px] space-y-2 overflow-y-auto pr-1'>
                <div className='text-muted-foreground flex items-center gap-2 px-1 text-xs'>
                  <span className='flex-1'>{t('Model name')}</span>
                  <span className='w-28 text-right'>{t('Floor (%)')}</span>
                  <span className='w-16 text-right'>{t('Multiplier')}</span>
                  <span className='w-8' />
                </div>
                {rows.map((row) => {
                  const percent = Number.parseFloat(row.percent)
                  const ratio = Number.isFinite(percent) ? percent / 100 : null
                  const isValidPercent =
                    ratio != null && ratio > 0 && ratio <= 1
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
                          searchPlaceholder={t('Search a model')}
                          emptyText={t('No matching model')}
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
                          aria-label={t('Floor (%)')}
                        />
                        <span className='text-muted-foreground text-sm'>%</span>
                      </div>
                      <span className='text-muted-foreground w-16 text-right font-mono text-xs tabular-nums'>
                        {isValidPercent ? `×${formatMultiplier(ratio)}` : '-'}
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
                'The floor is the deepest discount the agent may grant: 80% lets them price the model anywhere from 80% to 100% per member.'
              )}
            </p>
          </div>

          {isEdit ? (
            <div className='space-y-2'>
              <Label>{t('Status')}</Label>
              <div className='flex gap-2'>
                <Button
                  type='button'
                  variant={
                    status === AGENT_STATUS.ENABLED ? 'default' : 'outline'
                  }
                  size='sm'
                  onClick={() => setStatus(AGENT_STATUS.ENABLED)}
                >
                  {t('Enabled')}
                </Button>
                <Button
                  type='button'
                  variant={
                    status === AGENT_STATUS.DISABLED ? 'default' : 'outline'
                  }
                  size='sm'
                  onClick={() => setStatus(AGENT_STATUS.DISABLED)}
                >
                  {t('Disabled')}
                </Button>
              </div>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Disabling only locks the agent out of their own console; their members keep calling the authorized models.'
                )}
              </p>
            </div>
          ) : null}

          <div className='space-y-2'>
            <Label>{t('Remark')}</Label>
            <Textarea
              rows={2}
              maxLength={255}
              placeholder={t('Optional remark')}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
            />
          </div>

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
            disabled={isSubmitting || !canSubmit}
            onClick={() => void submit()}
          >
            {isSubmitting ? t('Saving...') : t('Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
