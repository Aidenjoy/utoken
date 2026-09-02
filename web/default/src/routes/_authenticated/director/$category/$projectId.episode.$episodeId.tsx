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

import { Main } from '@/components/layout'
import { isDirectorCategory } from '@/features/director/constants'
import { EpisodeStudioPage } from '@/features/director/director-episode-studio-page'

export const Route = createFileRoute(
  '/_authenticated/director/$category/$projectId/episode/$episodeId'
)({
  beforeLoad: ({ params }) => {
    if (!isDirectorCategory(params.category)) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: DirectorEpisodeRoutePage,
})

function DirectorEpisodeRoutePage() {
  const { category, projectId, episodeId } = Route.useParams()
  if (!isDirectorCategory(category)) {
    return null
  }
  return (
    <Main>
      <EpisodeStudioPage
        key={episodeId}
        category={category}
        projectId={Number(projectId)}
        episodeId={Number(episodeId)}
      />
    </Main>
  )
}
