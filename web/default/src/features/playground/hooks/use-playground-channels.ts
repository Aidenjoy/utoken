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
import { useEffect, useState } from 'react'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getPlaygroundChannels } from '../api'
import type { PlaygroundChannel } from '../types'

/**
 * 渠道选择器仅超级管理员可见：普通用户返回空列表（选择器隐藏），
 * 提交不带 channel_id，沿用自动选路。候选列表与当前模型无关（先选渠道再选模型）。
 */
export function usePlaygroundChannels(group: string) {
  const isRoot = useAuthStore(
    (state) => state.auth.user?.role === ROLE.SUPER_ADMIN
  )
  const [channels, setChannels] = useState<PlaygroundChannel[]>([])

  useEffect(() => {
    if (!isRoot) {
      setChannels([])
      return
    }
    let cancelled = false
    void getPlaygroundChannels(group).then((list) => {
      if (!cancelled) setChannels(list)
    })
    return () => {
      cancelled = true
    }
  }, [isRoot, group])

  return { isRoot, channels }
}