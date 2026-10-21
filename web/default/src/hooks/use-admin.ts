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
import { ROLE } from '@/lib/roles'
/**
 * Hook for checking admin privileges
 */
import { useAuthStore } from '@/stores/auth-store'

/**
 * Check if current user has admin privileges
 */
export function useIsAdmin(): boolean {
  const { user } = useAuthStore((state) => state.auth)
  return (user?.role ?? 0) >= ROLE.ADMIN
}

/**
 * Check if current user is a super admin (root). Gates the most sensitive
 * admin-only affordances, such as viewing a task's full request/response data.
 */
export function useIsSuperAdmin(): boolean {
  const { user } = useAuthStore((state) => state.auth)
  return (user?.role ?? 0) >= ROLE.SUPER_ADMIN
}

/**
 * Check if the current user is a reseller/agent (`is_agent`). Agents get scoped
 * views of the usage/task/drawing logs and the billing center, limited to the
 * members they recruited (plus themselves). Independent of `role`: an agent is
 * a normal user promoted to reseller, so `role` stays below ADMIN.
 */
export function useIsAgent(): boolean {
  const { user } = useAuthStore((state) => state.auth)
  return user?.is_agent === true
}

/**
 * Effective visibility scope for the logs/billing features:
 * - `admin`: full cross-user visibility (role >= ADMIN)
 * - `agent`: scoped to the agent's own members (+ self), server-enforced
 * - `self`: only the current user's own records
 * Admin takes precedence over agent.
 */
export type LogsScope = 'admin' | 'agent' | 'self'

export function useLogsScope(): LogsScope {
  const { user } = useAuthStore((state) => state.auth)
  if ((user?.role ?? 0) >= ROLE.ADMIN) return 'admin'
  if (user?.is_agent === true) return 'agent'
  return 'self'
}
