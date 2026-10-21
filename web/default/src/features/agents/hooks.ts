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

import type { Option } from '@/components/multi-select'
import { useIsAgent } from '@/hooks/use-admin'

import { listAgentMemberOptions } from './api'

/**
 * Member options for the agent-scoped filters (usage logs / billing center).
 * An agent may only pick their own members, and every scoped query enforces the
 * same range server-side, so this list is a picker convenience rather than a
 * security boundary. The query is disabled for non-agents (the endpoint is
 * agent-only), so the hook stays inert wherever it is mounted unconditionally.
 *
 * Options are MultiSelect-ready: `label` is `username (#id)` and `value` is the
 * stringified user id, which is what the scoped endpoints expect in `user_ids`.
 */
export function useAgentMemberOptions(): {
  options: Option[]
  isLoading: boolean
} {
  const isAgent = useIsAgent()
  const { data, isLoading } = useQuery({
    queryKey: ['agent-member-options'],
    queryFn: async () => {
      const res = await listAgentMemberOptions()
      return res.success ? (res.data ?? []) : []
    },
    enabled: isAgent,
    staleTime: 5 * 60 * 1000,
  })

  const options: Option[] = (data ?? []).map((member) => ({
    label: `${member.username} (#${member.user_id})`,
    value: String(member.user_id),
  }))

  return { options, isLoading }
}
