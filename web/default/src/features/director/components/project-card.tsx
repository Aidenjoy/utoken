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
import { Link } from '@tanstack/react-router'
import { Clapperboard, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import dayjs from '@/lib/dayjs'

import { PROJECT_STATUS_LABEL } from '../constants'
import type { DirectorCategory, DirectorProjectWithStats } from '../types'

interface ProjectCardProps {
  project: DirectorProjectWithStats
  category: DirectorCategory
  onEdit: (project: DirectorProjectWithStats) => void
  onDelete: (project: DirectorProjectWithStats) => void
}

export function ProjectCard(props: ProjectCardProps) {
  const { t } = useTranslation()
  const { project } = props

  const linkParams = {
    category: props.category,
    projectId: String(project.id),
  }

  return (
    <Card className='group overflow-hidden transition-shadow hover:shadow-md'>
      <Link
        to='/director/$category/$projectId'
        params={linkParams}
        className='block'
      >
        <div className='bg-muted relative aspect-video w-full overflow-hidden'>
          {project.thumbnail ? (
            <img
              src={project.thumbnail}
              alt={project.title}
              className='size-full object-cover transition-transform group-hover:scale-105'
            />
          ) : (
            <div className='text-muted-foreground flex size-full items-center justify-center'>
              <Clapperboard aria-hidden='true' className='size-8' />
            </div>
          )}
          <Badge
            variant='secondary'
            className='bg-background/80 absolute top-2 left-2'
          >
            {t(PROJECT_STATUS_LABEL[project.status] ?? project.status)}
          </Badge>
        </div>
      </Link>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center justify-between gap-2 text-base'>
          <Link
            to='/director/$category/$projectId'
            params={linkParams}
            className='truncate hover:underline'
          >
            {project.title}
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-7 shrink-0'
                  aria-label={t('More actions')}
                />
              }
            >
              <MoreHorizontal aria-hidden='true' className='size-4' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => props.onEdit(project)}>
                {t('Edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant='destructive'
                onClick={() => props.onDelete(project)}
              >
                {t('Delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardTitle>
      </CardHeader>
      <Link
        to='/director/$category/$projectId'
        params={linkParams}
        className='block'
      >
        <CardContent className='text-muted-foreground space-y-2 text-sm'>
          {project.genre || project.style ? (
            <div className='flex flex-wrap gap-1'>
              {project.genre && <Badge variant='outline'>{project.genre}</Badge>}
              {project.style && <Badge variant='outline'>{project.style}</Badge>}
            </div>
          ) : null}
          <p className='line-clamp-2 min-h-10'>{project.description}</p>
          <div className='flex items-center justify-between text-xs'>
            <span>
              {project.episodeCount} {t('Episodes')} · {project.characterCount}{' '}
              {t('Characters')} · {project.sceneCount} {t('Scenes')}
            </span>
            <span>{dayjs.unix(project.updatedAt).format('YYYY-MM-DD')}</span>
          </div>
        </CardContent>
      </Link>
    </Card>
  )
}
