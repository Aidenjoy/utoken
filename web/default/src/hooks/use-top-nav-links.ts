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
import {
  BookOpen,
  Camera,
  Clapperboard,
  FileText,
  Image as ImageIcon,
  Images,
  Layers,
  Megaphone,
  Package,
  Scissors,
  Shirt,
  ShoppingCart,
  Sparkles,
  UserRound,
  Users,
  ZoomIn,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export type TopNavLink = {
  title: string
  href: string
  disabled?: boolean
  requiresAuth?: boolean
  external?: boolean
  sameTab?: boolean
  icon?: React.ElementType
  children?: TopNavLink[]
}

/**
 * Generate top navigation links based on HeaderNavModules configuration from backend /api/status
 * Backend format example (stringified JSON):
 * {
 *   home: true,
 *   console: true,
 *   pricing: { enabled: true, requireAuth: false },
 *   rankings: { enabled: true, requireAuth: false },
 *   docs: true,
 *   about: true
 * }
 */
export function useTopNavLinks(): TopNavLink[] {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { auth } = useAuthStore()

  // Parse HeaderNavModules
  const modules = useMemo(() => {
    return parseHeaderNavModulesFromStatus(
      status as Record<string, unknown> | null
    )
  }, [status])

  // Documentation link (may be external)
  const docsLink: string | undefined = status?.docs_link as string | undefined

  const isAuthed = !!auth?.user

  const links: TopNavLink[] = []

  // 首页
  if (modules?.home !== false) {
    links.push({ title: t('Home'), href: '/' })
  }

  // 视频工厂 — 四个视频创作方向
  links.push({
    title: t('Video Factory'),
    href: '/director',
    children: [
      {
        title: t('Short Drama'),
        href: '/director/drama',
        requiresAuth: !isAuthed,
        icon: Clapperboard,
      },
      {
        title: t('E-commerce Video'),
        href: '/director/ecommerce',
        requiresAuth: !isAuthed,
        icon: ShoppingCart,
      },
      {
        title: t('Ad Video'),
        href: '/director/ad',
        requiresAuth: !isAuthed,
        icon: Megaphone,
      },
      {
        title: t('Daily Video'),
        href: '/director/daily',
        requiresAuth: !isAuthed,
        icon: Camera,
      },
    ],
  })

  // 模特穿搭 — 自由/多件/双人换衣已上线
  links.push({
    title: t('Model Styling'),
    href: '',
    children: [
      {
        title: t('Dedicated Model'),
        href: '/try-on/model-studio',
        requiresAuth: !isAuthed,
        icon: UserRound,
      },
      {
        title: t('Free Try-On'),
        href: '/try-on/free',
        requiresAuth: !isAuthed,
        icon: Shirt,
      },
      {
        title: t('Multi-Item Try-On'),
        href: '/try-on/multi',
        requiresAuth: !isAuthed,
        icon: Layers,
      },
      {
        title: t('Duo Try-On'),
        href: '/try-on/duo',
        requiresAuth: !isAuthed,
        icon: Users,
      },
    ],
  })

  // 爆款主图 — 主图设计已上线，套图/详情页/细节图开发中
  links.push({
    title: t('Viral Hero Image'),
    href: '',
    children: [
      {
        title: t('Hero Image Design'),
        href: '/viral-hero/hero-design',
        requiresAuth: !isAuthed,
        icon: ImageIcon,
      },
      {
        title: t('Hero Image Set'),
        href: '/viral-hero/hero-set',
        requiresAuth: !isAuthed,
        icon: Images,
      },
      {
        title: t('Detail Page Images'),
        href: '/viral-hero/detail-page',
        requiresAuth: !isAuthed,
        icon: FileText,
      },
      {
        title: t('Detail Images'),
        href: '/viral-hero/detail-images',
        requiresAuth: !isAuthed,
        icon: ZoomIn,
      },
    ],
  })

  // 爆款设计 — 商品设计与服装设计均已上线
  links.push({
    title: t('Viral Design'),
    href: '',
    children: [
      {
        title: t('Fashion Design'),
        href: '/viral-design/fashion',
        requiresAuth: !isAuthed,
        icon: Scissors,
      },
      {
        title: t('Merchandise Design'),
        href: '/viral-design/merchandise',
        requiresAuth: !isAuthed,
        icon: Package,
      },
    ],
  })

  // Pricing
  const pricing = modules?.pricing
  if (pricing && typeof pricing === 'object' && pricing.enabled) {
    const requiresAuth = pricing.requireAuth && !isAuthed
    links.push({ title: t('Model Square'), href: '/pricing', requiresAuth })
  }

  // Rankings — displayed as Model Square
  const rankings = modules?.rankings
  if (rankings && typeof rankings === 'object' && rankings.enabled) {
    const requiresAuth = rankings.requireAuth && !isAuthed
    links.push({ title: t('Model Square'), href: '/pricing', requiresAuth })
  }

  // 教程 — 开发者文档移至二级，设计觉醒开发中
  links.push({
    title: t('Tutorials'),
    href: '',
    children: [
      { title: t('Developer Docs'), href: '/docs', icon: BookOpen },
      {
        title: t('Design awakening'),
        href: '',
        disabled: true,
        icon: Sparkles,
      },
    ],
  })

  // Docs (supports external links) — hidden by default, enable via backend config
  if (modules?.docs === true) {
    if (docsLink) {
      links.push({ title: t('Docs'), href: docsLink, external: true })
    } else {
      links.push({ title: t('Docs'), href: '/docs' })
    }
  }

  // About — hidden by default, enable via backend config
  if (modules?.about === true) {
    links.push({ title: t('About'), href: '/about' })
  }

  // 去除标题与地址完全相同的重复项（例如 pricing 与 rankings 同时开启）。
  return links.filter(
    (link, index) =>
      links.findIndex(
        (item) => item.title === link.title && item.href === link.href
      ) === index
  )
}
