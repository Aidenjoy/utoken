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
import { Search } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import type { OwnerSelection } from '@/lib/owner'

export interface OwnerOption {
  id: number
  username: string
}

interface OwnerFilterProps {
  value: OwnerSelection
  onChange: (value: OwnerSelection) => void
}

// 管理员归属筛选：自己 / 全部用户 / 按用户名搜索后选中的指定用户。
// 仅管理员界面渲染本组件；后端对非管理员会忽略 userId 参数。
export function OwnerFilter(props: OwnerFilterProps) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = React.useState('')
  const [searching, setSearching] = React.useState(false)
  // 已搜到的用户选项（去重累积，保证已选中项始终可显示）
  const [options, setOptions] = React.useState<OwnerOption[]>([])

  const selectValue =
    props.value.kind === 'user' ? `user:${props.value.id}` : props.value.kind

  const handleSearch = async () => {
    const kw = keyword.trim()
    if (!kw) return
    setSearching(true)
    try {
      const res = await api.get('/api/user/search', {
        params: { keyword: kw, p: 1, page_size: 20 },
      })
      const items: OwnerOption[] = res.data?.data?.items ?? []
      if (items.length === 0) {
        toast.info(t('No matching users'))
        return
      }
      setOptions((prev) => {
        const merged = [...prev]
        for (const u of items) {
          if (!merged.some((o) => o.id === u.id)) merged.push(u)
        }
        return merged
      })
    } catch (err) {
      handleServerError(err)
    } finally {
      setSearching(false)
    }
  }

  const handleChange = (v: string | null) => {
    if (!v) return
    if (v === 'self') {
      props.onChange({ kind: 'self' })
      return
    }
    if (v === 'all') {
      props.onChange({ kind: 'all' })
      return
    }
    const id = Number(v.slice('user:'.length))
    const hit = options.find((o) => o.id === id)
    if (hit) {
      props.onChange({ kind: 'user', id: hit.id, username: hit.username })
    }
  }

  return (
    <div className='flex items-center gap-2'>
      <Select
        value={selectValue}
        onValueChange={handleChange}
        items={[
          { value: 'self', label: t('Mine') },
          { value: 'all', label: t('All Users') },
          ...options.map((o) => ({
            value: `user:${o.id}`,
            label: `#${o.id} ${o.username}`,
          })),
        ]}
      >
        <SelectTrigger className='w-44'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='self'>{t('Mine')}</SelectItem>
          <SelectItem value='all'>{t('All Users')}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={`user:${o.id}`}>
              #{o.id} {o.username}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className='relative'>
        <Input
          className='w-40 pr-8'
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSearch()
          }}
          placeholder={t('Username')}
        />
        <Button
          variant='ghost'
          size='icon'
          className='absolute top-1/2 right-0.5 size-7 -translate-y-1/2'
          disabled={searching}
          aria-label={t('Search')}
          title={t('Search')}
          onClick={() => void handleSearch()}
        >
          <Search aria-hidden='true' className='size-3.5' />
        </Button>
      </div>
    </div>
  )
}
