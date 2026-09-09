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
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { Prompts } from '@/features/prompts'
import { PROMPT_SCOPE_VALUES } from '@/features/prompts/constants'
import { PROMPT_VISIBILITY_FILTER_VALUES } from '@/features/prompts/types'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'

const promptsSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(20),
  filter: z.string().optional().catch(''),
  tag: z.array(z.string()).optional().catch([]),
  visibility: z
    .array(z.enum(PROMPT_VISIBILITY_FILTER_VALUES))
    .optional()
    .catch([]),
  scope: z.array(z.enum(PROMPT_SCOPE_VALUES)).optional().catch([]),
})

export const Route = createFileRoute('/_authenticated/prompts/')({
  beforeLoad: () => {
    // The library is available to every signed-in user (public templates are
    // readable by all), so access is gated by the sidebar module switch only.
    if (!isSidebarModuleEnabled('chat', 'prompt')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: promptsSearchSchema,
  component: Prompts,
})
