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
import { Link, useRouterState } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimatedOutlet } from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

// 视频工厂、模特穿搭、爆款主图与爆款设计四个创作分组属于付费体验：
// 余额不大于 0 的账号只看到充值提示，不渲染页面内容，避免功能外泄。
// 素材库挂在个人分组下，不在门禁范围内。
const QUOTA_GATED_PREFIXES = [
  '/director',
  '/try-on',
  '/viral-hero',
  '/viral-design',
]
const QUOTA_EXEMPT_PREFIXES = ['/director/assets']

function isQuotaGatedPath(pathname: string): boolean {
  const matches = (prefix: string) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  if (QUOTA_EXEMPT_PREFIXES.some(matches)) return false
  return QUOTA_GATED_PREFIXES.some(matches)
}

/** Renders the routed page, or a top-up notice when the quota gate blocks it. */
export function QuotaGatedOutlet() {
  const { t } = useTranslation()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const quota = useAuthStore((state) => state.auth.user?.quota ?? 0)

  if (!isQuotaGatedPath(pathname) || quota > 0) {
    return <AnimatedOutlet />
  }

  return (
    <div
      className='flex h-full flex-col items-center justify-center gap-4 p-6 text-center'
      role='alert'
    >
      <div className='bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full'>
        <Wallet className='size-5' />
      </div>
      <p className='text-muted-foreground max-w-sm text-sm'>
        {t('Insufficient balance, please top up to continue')}
      </p>
      <Button render={<Link to='/wallet' />}>{t('Recharge')}</Button>
    </div>
  )
}
