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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, createContext, useCallback, useContext } from 'react'

import { getOrgSummary, getOrganization } from '../api'
import { ORG_ROLE, type OrgSummary, type OrganizationDetail } from '../types'

type OrganizationContextValue = {
  summary?: OrgSummary
  /** Only loaded for organization admins; the endpoint requires that role. */
  detail?: OrganizationDetail
  isLoading: boolean
  isOrgAdmin: boolean
  /** Invalidates every organization query so all sections refetch together. */
  triggerRefresh: () => void
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null)

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const summaryQuery = useQuery({
    queryKey: ['org-summary'],
    queryFn: async () => {
      const result = await getOrgSummary()
      return result.success ? result.data : undefined
    },
  })

  const summary = summaryQuery.data
  const orgId = summary?.org_id ?? 0
  const isOrgAdmin = orgId > 0 && summary?.org_role === ORG_ROLE.ADMIN

  // Organization settings, member count and the Redis availability flag live
  // behind OrgAdminAuth. A plain member would only get a 403, so the query is
  // skipped entirely for them.
  const detailQuery = useQuery({
    queryKey: ['org-detail', orgId],
    enabled: isOrgAdmin,
    queryFn: async () => {
      const result = await getOrganization()
      return result.success ? result.data : undefined
    },
  })

  const triggerRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['org-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['org-detail'] })
    void queryClient.invalidateQueries({ queryKey: ['org-members'] })
    void queryClient.invalidateQueries({ queryKey: ['org-usage'] })
    void queryClient.invalidateQueries({ queryKey: ['org-logs'] })
  }, [queryClient])

  return (
    <OrganizationContext
      value={{
        summary,
        detail: detailQuery.data,
        isLoading:
          summaryQuery.isLoading || (isOrgAdmin && detailQuery.isLoading),
        isOrgAdmin,
        triggerRefresh,
      }}
    >
      {children}
    </OrganizationContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (!context) {
    throw new Error(
      'useOrganization has to be used within <OrganizationProvider>'
    )
  }
  return context
}

/**
 * 供可在 Provider 外复用的组件（如系统管理员代管企业成员的抽屉）使用：
 * 无 Provider 时返回 null，由调用方自行提供刷新回调与目标企业。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalOrganization() {
  return useContext(OrganizationContext)
}
