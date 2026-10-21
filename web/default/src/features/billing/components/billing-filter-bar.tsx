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
import { useQuery } from '@tanstack/react-query'
import { Loader2, RotateCcw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { useAgentMemberOptions } from '@/features/agents/hooks'
import { getAdminOrganizations } from '@/features/organizations/api'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { getUsers } from '@/features/users/api'

import {
  BILLING_SCOPE_ALL,
  BILLING_SCOPE_NONE,
  normalizeBillingScope,
  type BillingFilterDraft,
} from '../types'

interface BillingFilterBarProps {
  draft: BillingFilterDraft
  isAgent?: boolean
  onDraftChange: (
    updater: (current: BillingFilterDraft) => BillingFilterDraft
  ) => void
  onSearch: () => void
  onReset: () => void
  searching: boolean
}

export function BillingFilterBar(props: BillingFilterBarProps) {
  const { t } = useTranslation()
  const isAgent = props.isAgent ?? false

  // Agent member picker; disabled for non-agents inside the hook.
  const { options: memberOptions } = useAgentMemberOptions()

  const { data: userOptions = [] } = useQuery({
    queryKey: ['billing-user-options'],
    queryFn: async () => {
      const result = await getUsers({ p: 1, page_size: 1000 })
      return (result.data?.items ?? []).map((user) => ({
        label: `${user.username} (#${user.id})`,
        value: String(user.id),
      }))
    },
    staleTime: 5 * 60 * 1000,
    enabled: !isAgent,
  })

  const { data: orgOptions = [] } = useQuery({
    queryKey: ['billing-org-options'],
    queryFn: async () => {
      const result = await getAdminOrganizations({ p: 1, page_size: 500 })
      return (result.data?.items ?? []).map((org) => ({
        label: `${org.display_name || org.name} (#${org.id})`,
        value: String(org.id),
      }))
    },
    staleTime: 5 * 60 * 1000,
    enabled: !isAgent,
  })

  // Agents pick only among their own members and cannot exclude by "None"
  // (the server already forces the member range), so the None sentinel is
  // dropped from the agent user scope.
  const userScopeOptions = isAgent
    ? [{ value: BILLING_SCOPE_ALL, label: t('All') }, ...memberOptions]
    : [
        { value: BILLING_SCOPE_ALL, label: t('All') },
        { value: BILLING_SCOPE_NONE, label: t('None') },
        ...userOptions,
      ]
  const orgScopeOptions = [
    { value: BILLING_SCOPE_ALL, label: t('All') },
    { value: BILLING_SCOPE_NONE, label: t('None') },
    ...orgOptions,
  ]

  return (
    <div className='border-border/60 bg-card rounded-xl border p-3 shadow-xs'>
      <div className='flex flex-wrap items-center gap-2'>
        <MultiSelect
          className='min-w-[220px] flex-1'
          options={userScopeOptions}
          selected={props.draft.userSel}
          onChange={(values) =>
            props.onDraftChange((current) => ({
              ...current,
              userSel: normalizeBillingScope(current.userSel, values),
            }))
          }
          placeholder={isAgent ? t('Select members') : t('Select users')}
          maxVisibleChips={2}
        />

        {!isAgent && (
          <MultiSelect
            className='min-w-[200px] flex-1'
            options={orgScopeOptions}
            selected={props.draft.orgSel}
            onChange={(values) =>
              props.onDraftChange((current) => ({
                ...current,
                orgSel: normalizeBillingScope(current.orgSel, values),
              }))
            }
            placeholder={t('Select organizations')}
            maxVisibleChips={2}
          />
        )}

        <CompactDateTimeRangePicker
          start={props.draft.start}
          end={props.draft.end}
          onChange={({ start, end }) =>
            props.onDraftChange((current) => ({ ...current, start, end }))
          }
        />

        <div className='ml-auto flex items-center gap-2'>
          <Button variant='ghost' size='sm' onClick={props.onReset}>
            <RotateCcw />
            {t('Reset')}
          </Button>
          <Button size='sm' onClick={props.onSearch} disabled={props.searching}>
            {props.searching ? (
              <Loader2 className='animate-spin' />
            ) : (
              <Search />
            )}
            {t('Query')}
          </Button>
        </div>
      </div>
      <p className='text-muted-foreground mt-2 text-xs'>
        {t(
          'Query and export recharge and consumption records for selected users and organizations.'
        )}
      </p>
    </div>
  )
}
