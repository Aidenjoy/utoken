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
import { AxiosError } from 'axios'
import i18next from 'i18next'
import { toast } from 'sonner'

export function handleServerError(error: unknown) {
  // eslint-disable-next-line no-console
  console.log(error)

  let errMsg = i18next.t('Something went wrong!')

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = i18next.t('Content not found.')
  }

  if (error instanceof AxiosError && error.response) {
    // HTTP 错误已由 lib/api.ts 全局响应拦截器统一 toast（含网关 504 等 HTML 响应）；
    // 未跳过全局处理时这里直接返回，避免同一错误弹出两个重复/空内容的提示
    if (!error.config?.skipErrorHandler) {
      return
    }
    const data = error.response.data as
      | { title?: string; message?: string }
      | undefined
    errMsg =
      data?.title || data?.message || error.message || errMsg
  }

  toast.error(errMsg)
}
