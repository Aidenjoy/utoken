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
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'

import { getDirectorEpisodePipeline } from './api'
import { DirectorStudio } from './studio/director-studio'

interface EpisodeStudioPageProps {
  category: string
  projectId: number
  episodeId: number
}

export function EpisodeStudioPage(props: EpisodeStudioPageProps) {
  const { t } = useTranslation()

  // 仅用于页面标题展示分集名，工作室内部自行轮询流水线
  const pipelineQuery = useQuery({
    queryKey: ['director', 'pipeline', props.episodeId],
    queryFn: () => getDirectorEpisodePipeline(props.episodeId),
  })

  const episode = pipelineQuery.data?.data?.episode

  return (
    <SectionPageLayout>
      <SectionPageLayout.Breadcrumb>
        <Link
          to='/director/$category/$projectId'
          params={{
            category: props.category,
            projectId: String(props.projectId),
          }}
          className='text-muted-foreground hover:text-foreground flex items-center gap-1'
        >
          <ArrowLeft aria-hidden='true' className='size-4' />
          {t('Project Detail')}
        </Link>
      </SectionPageLayout.Breadcrumb>
      <SectionPageLayout.Title>
        {episode?.title ?? t('Episode Studio')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <DirectorStudio
          episodeId={props.episodeId}
          projectId={props.projectId}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
