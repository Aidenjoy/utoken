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
import { Loader2, Plus, RotateCcw, Search } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { MultiSelect, type Option } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getAdminOrganizations } from '@/features/organizations/api'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { getUsers, searchUsers } from '@/features/users/api'

import type { BillingFilterDraft } from '../types'

interface BillingFilterBarProps {
  draft: BillingFilterDraft
  onDraftChange: (
    updater: (current: BillingFilterDraft) => BillingFilterDraft
  ) => void
  onSearch: () => void
  onReset: () => void
  searching: boolean
}

function mergeOptions(base: Option[], extra: Option[]): Option[] {
  const merged = [...base]
  for (const option of extra) {
    if (!merged.some((item) => item.value === option.value)) merged.push(option)
  }
  return merged
}

export function BillingFilterBar(props: BillingFilterBarProps) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const [extraUsers, setExtraUsers] = useState<Option[]>([])
  const [userSearching, setUserSearching] = useState(false)

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
  })

  const mergedUserOptions = useMemo(
    () => mergeOptions(userOptions, extraUsers),
    [extraUsers, userOptions]
  )

  const handleUserSearch = useCallback(async () => {
    const kw = keyword.trim()
    if (!kw) return
    setUserSearching(true)
    try {
      const result = await searchUsers({ keyword: kw, p: 1, page_size: 50 })
      const items = result.data?.items ?? []
      if (items.length === 0) {
        toast.info(t('No matching users'))
        return
      }
      setExtraUsers((current) =>
        mergeOptions(
          current,
          items.map((user) => ({
            label: `${user.username} (#${user.id})`,
            value: String(user.id),
          }))
        )
      )
    } catch {
      toast.error(t('Failed to search users'))
    } finally {
      setUserSearching(false)
    }
  }, [keyword, t])

  const selectedUsers = props.draft.userIds.map(String)
  const selectedOrgs = props.draft.orgIds.map(String)

  return (
    <div className='border-border/60 bg-card rounded-xl border p-3 shadow-xs'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='flex items-center gap-1.5'>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleUserSearch()
            }}
            placeholder={t('Search users to add')}
            className='h-8 w-[170px] text-xs'
          />
          <Button
            variant='ghost'
            size='icon'
            className='size-8 shrink-0'
            onClick={handleUserSearch}
            disabled={userSearching || !keyword.trim()}
            aria-label={t('Search users to add')}
          >
            {userSearching ? <Loader2 className='animate-spin' /> : <Plus />}
          </Button>
        </div>

        <MultiSelect
          className='min-w-[220px] flex-1'
          options={mergedUserOptions}
          selected={selectedUsers}
          onChange={(values) =>
            props.onDraftChange((current) => ({
              ...current,
              userIds: values.map(Number),
            }))
          }
          placeholder={t('Select users')}
          maxVisibleChips={2}
        />

        <MultiSelect
          className='min-w-[200px] flex-1'
          options={orgOptions}
          selected={selectedOrgs}
          onChange={(values) =>
            props.onDraftChange((current) => ({
              ...current,
              orgIds: values.map(Number),
            }))
          }
          placeholder={t('Select organizations')}
          maxVisibleChips={2}
        />

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
