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

import { Main } from '@/components/layout'
import { Playground } from '@/features/playground'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'

// `prompt` carries a template picked from the Prompt Library so the playground
// can pre-fill the composer with it. It is intentionally kept out of the
// persisted conversation: nothing is sent until the user submits.
const playgroundSearchSchema = z.object({
  prompt: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/playground/')({
  beforeLoad: () => {
    if (!isSidebarModuleEnabled('chat', 'playground')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  validateSearch: playgroundSearchSchema,
  component: PlaygroundPage,
})

function PlaygroundPage() {
  const { prompt } = Route.useSearch()

  return (
    <Main className='p-0'>
      <Playground initialPrompt={prompt} />
    </Main>
  )
}
