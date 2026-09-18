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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { getPricing } from '@/features/pricing/api'
import { useStatus } from '@/hooks/use-status'
import { getModuleAccessFromStatus } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export function Ecosystem() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const isAuthenticated = useAuthStore((state) => !!state.auth.user)
  const access = getModuleAccessFromStatus(status, 'pricing')
  const canBrowse =
    !!status && access.enabled && (!access.requireAuth || isAuthenticated)
  const pricing = useQuery({
    queryKey: ['pricing'],
    queryFn: getPricing,
    staleTime: 5 * 60 * 1000,
    enabled: canBrowse,
  })
  // 目录未开放或需要登录时，不在公开首页请求受保护的数据。
  if (!canBrowse || pricing.isPending) return null

  const vendors = pricing.data?.success ? pricing.data.vendors : []
  const names = [
    ...new Set(vendors.map((vendor) => vendor.name).filter(Boolean)),
  ].slice(0, 8)
  // 纯装饰性区块，目录不可用时静默隐藏，不在首页展示错误。
  if (names.length === 0) return null

  return (
    <section className='home-section' aria-labelledby='home-ecosystem-title'>
      <div className='home-container'>
        <h2 id='home-ecosystem-title' className='home-ecosystem-title'>
          {t('Models from the providers you already know.')}
        </h2>
        <ul className='home-vendors'>
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <Link to='/pricing' className='home-text-link text-[15px]'>
          {t('View all models')}
        </Link>
      </div>
    </section>
  )
}
