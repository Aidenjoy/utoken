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

import { getLogBodies } from '../api'

/**
 * 使用日志详情的「传入/传出参数」快照按需拉取。大 JSON 存独立表、不进列表 payload，
 * 因此仅在详情弹窗打开（enabled=true）且有 request_id 时才发起请求；关闭即失效。
 * 可见范围由服务端强制（越权/历史无快照返回空串），前端只管展示。
 */
export function useLogBodies(
  requestId: string | undefined,
  enabled: boolean
): {
  requestData: string
  responseData: string
  isLoading: boolean
} {
  const { data, isLoading } = useQuery({
    queryKey: ['log-bodies', requestId],
    queryFn: async () => {
      const res = await getLogBodies(requestId as string)
      return res.success ? res.data : undefined
    },
    enabled: enabled && !!requestId,
    staleTime: 5 * 60 * 1000,
  })

  return {
    requestData: data?.request_data ?? '',
    responseData: data?.response_data ?? '',
    isLoading,
  }
}
