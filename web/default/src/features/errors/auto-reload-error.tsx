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
import * as React from 'react'

import { GeneralError, getHttpStatus } from './general-error'

// 根错误组件：无 HTTP 状态的运行时崩溃（典型场景：部署新版后旧 SPA 会话懒加载已不存在的
// 旧 chunk，或新旧混合模块图求值失败）自动刷新一次即可恢复；sessionStorage 守卫防止无限刷新，
// 刷新后仍然崩溃时回退到 GeneralError 手动处理。
const RELOAD_GUARD_KEY = 'root_error_auto_reloaded'

export function RootError({ error }: { error?: unknown }) {
  // 渲染阶段消费并立即清除守卫：走到这里说明应用已重新构建成功，
  // 下一次崩溃允许再自动刷新一次（清除放 effect 里会因根组件已先挂载而失效）
  const [guardConsumed] = React.useState(() => {
    try {
      const consumed = window.sessionStorage.getItem(RELOAD_GUARD_KEY) === '1'
      window.sessionStorage.removeItem(RELOAD_GUARD_KEY)
      return consumed
    } catch {
      return true // 存储不可用时视为已刷新过，直接展示错误页，避免刷新循环
    }
  })

  const isRuntimeCrash = getHttpStatus(error) === undefined

  React.useEffect(() => {
    if (!isRuntimeCrash || guardConsumed) return
    try {
      window.sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
    } catch {
      /* 存储不可用时不刷新，直接展示错误页 */
      return
    }
    window.location.reload()
  }, [isRuntimeCrash, guardConsumed])

  return <GeneralError error={error} />
}
