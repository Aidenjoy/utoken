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
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { formatDiscount } from '@/lib/discount'

import { createAgent, updateAgent } from '../api'
import { AGENT_STATUS, type Agent } from '../types'

type Props = {
  open: boolean
  agent: Agent | null
  onOpenChange: (open: boolean) => void
}

/**
 * Promote a registered user to reseller (create) or edit an existing reseller's
 * discount range / status / remark. Discounts are pay multipliers in (0, 1]:
 * min is the deepest discount the agent may issue, max the shallowest (1 = full
 * price). The server enforces 0 < min <= max <= 1.
 */
export function SetAgentDialog({ open, agent, onOpenChange }: Props) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = agent !== null

  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<User | null>(null)
  const [minDiscount, setMinDiscount] = useState('0.8')
  const [maxDiscount, setMaxDiscount] = useState('1')
  const [status, setStatus] = useState<number>(AGENT_STATUS.ENABLED)
  const [remark, setRemark] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setKeyword('')
    setResults([])
    if (agent) {
      setMinDiscount(String(agent.min_discount))
      setMaxDiscount(String(agent.max_discount))
      setStatus(agent.status)
      setRemark(agent.remark ?? '')
    } else {
      setMinDiscount('0.8')
      setMaxDiscount('1')
      setStatus(AGENT_STATUS.ENABLED)
      setRemark('')
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

  const minParsed = Number.parseFloat(minDiscount)
  const maxParsed = Number.parseFloat(maxDiscount)
  const rangeValid =
    Number.isFinite(minParsed) &&
    Number.isFinite(maxParsed) &&
    minParsed > 0 &&
    maxParsed > 0 &&
    minParsed <= maxParsed &&
    maxParsed <= 1
  const canSubmit = rangeValid && (isEdit || selected !== null)

  const submit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      if (isEdit && agent) {
        const res = await updateAgent(agent.id, {
          min_discount: minParsed,
          max_discount: maxParsed,
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
          min_discount: minParsed,
          max_discount: maxParsed,
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
      <DialogContent className='sm:max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('Edit Agent') : t('Promote User to Agent')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Set the discount range this agent may issue. Discount is the payment multiplier: 0.6 means the invitee pays 60%.'
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

          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label>{t('Max Discount (min multiplier)')}</Label>
              <Input
                type='number'
                min={0.01}
                max={1}
                step={0.01}
                value={minDiscount}
                onChange={(event) => setMinDiscount(event.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label>{t('Min Discount (max multiplier)')}</Label>
              <Input
                type='number'
                min={0.01}
                max={1}
                step={0.01}
                value={maxDiscount}
                onChange={(event) => setMaxDiscount(event.target.value)}
              />
            </div>
          </div>
          <p className='text-muted-foreground text-xs'>
            {rangeValid
              ? t('Allowed range: {{range}}', {
                  range: `${formatDiscount(
                    minParsed,
                    i18n.language,
                    t
                  )} – ${formatDiscount(maxParsed, i18n.language, t)}`,
                })
              : t('Require 0 < min ≤ max ≤ 1')}
          </p>

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
