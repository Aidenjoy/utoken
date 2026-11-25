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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MultiSelect, type Option } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { useAgentMemberOptions } from '@/features/agents/hooks'
import { getAdminOrganizations } from '@/features/organizations/api'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { getUsers, searchUsers } from '@/features/users/api'
import { useDebounce } from '@/hooks'

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

  // 远程搜索：后端 GetPageQuery 把 page_size 硬限到 100，只拉首页会让
  // 注册较早的用户永远选不到，所以输入关键字时走服务端搜索。
  const [userQuery, setUserQuery] = useState('')
  const [orgQuery, setOrgQuery] = useState('')
  const debouncedUserQuery = useDebounce(userQuery, 300).trim()
  const debouncedOrgQuery = useDebounce(orgQuery, 300).trim()

  const { data: userOptions = [] } = useQuery({
    queryKey: ['billing-user-options'],
    queryFn: async () => {
      const result = await getUsers({ p: 1, page_size: 100 })
      return (result.data?.items ?? []).map((user) => ({
        label: `${user.username} (#${user.id})`,
        value: String(user.id),
      }))
    },
    staleTime: 5 * 60 * 1000,
    enabled: !isAgent,
  })

  const { data: searchedUserOptions = [] } = useQuery({
    queryKey: ['billing-user-search', debouncedUserQuery],
    queryFn: async () => {
      const result = await searchUsers({
        keyword: debouncedUserQuery,
        p: 1,
        page_size: 100,
      })
      return (result.data?.items ?? []).map((user) => ({
        label: `${user.username} (#${user.id})`,
        value: String(user.id),
      }))
    },
    staleTime: 5 * 60 * 1000,
    enabled: !isAgent && debouncedUserQuery !== '',
  })

  const { data: orgOptions = [] } = useQuery({
    queryKey: ['billing-org-options'],
    queryFn: async () => {
      const result = await getAdminOrganizations({ p: 1, page_size: 100 })
      return (result.data?.items ?? []).map((org) => ({
        label: `${org.display_name || org.name} (#${org.id})`,
        value: String(org.id),
      }))
    },
    staleTime: 5 * 60 * 1000,
    enabled: !isAgent,
  })

  const { data: searchedOrgOptions = [] } = useQuery({
    queryKey: ['billing-org-search', debouncedOrgQuery],
    queryFn: async () => {
      const result = await getAdminOrganizations({
        p: 1,
        page_size: 100,
        keyword: debouncedOrgQuery,
      })
      return (result.data?.items ?? []).map((org) => ({
        label: `${org.display_name || org.name} (#${org.id})`,
        value: String(org.id),
      }))
    },
    staleTime: 5 * 60 * 1000,
    enabled: !isAgent && debouncedOrgQuery !== '',
  })

  // 已选值的 label 缓存：搜索结果会随输入清空而消失，缓存保证已选
  // 用户/企业的 chip 仍显示名称而不是裸 ID。
  const userLabelCache = useRef(new Map<string, Option>())
  const orgLabelCache = useRef(new Map<string, Option>())
  useEffect(() => {
    for (const option of userOptions) {
      userLabelCache.current.set(option.value, option)
    }
    for (const option of searchedUserOptions) {
      userLabelCache.current.set(option.value, option)
    }
  }, [userOptions, searchedUserOptions])
  useEffect(() => {
    for (const option of orgOptions) {
      orgLabelCache.current.set(option.value, option)
    }
    for (const option of searchedOrgOptions) {
      orgLabelCache.current.set(option.value, option)
    }
  }, [orgOptions, searchedOrgOptions])

  // Agents pick only among their own members and cannot exclude by "None"
  // (the server already forces the member range), so the None sentinel is
  // dropped from the agent user scope.
  const userScopeOptions = useMemo(() => {
    if (isAgent) {
      return [{ value: BILLING_SCOPE_ALL, label: t('All') }, ...memberOptions]
    }
    const source = debouncedUserQuery ? searchedUserOptions : userOptions
    const merged = new Map(source.map((option) => [option.value, option]))
    for (const value of props.draft.userSel) {
      const cached = userLabelCache.current.get(value)
      if (cached && !merged.has(value)) merged.set(value, cached)
    }
    return [
      { value: BILLING_SCOPE_ALL, label: t('All') },
      { value: BILLING_SCOPE_NONE, label: t('None') },
      ...merged.values(),
    ]
  }, [
    isAgent,
    memberOptions,
    debouncedUserQuery,
    searchedUserOptions,
    userOptions,
    props.draft.userSel,
    t,
  ])
  const orgScopeOptions = useMemo(() => {
    const source = debouncedOrgQuery ? searchedOrgOptions : orgOptions
    const merged = new Map(source.map((option) => [option.value, option]))
    for (const value of props.draft.orgSel) {
      const cached = orgLabelCache.current.get(value)
      if (cached && !merged.has(value)) merged.set(value, cached)
    }
    return [
      { value: BILLING_SCOPE_ALL, label: t('All') },
      { value: BILLING_SCOPE_NONE, label: t('None') },
      ...merged.values(),
    ]
  }, [debouncedOrgQuery, searchedOrgOptions, orgOptions, props.draft.orgSel, t])

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
          remoteSearch={!isAgent}
          onSearchChange={isAgent ? undefined : setUserQuery}
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
            remoteSearch
            onSearchChange={setOrgQuery}
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
