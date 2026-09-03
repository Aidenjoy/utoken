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
import { Clapperboard, MoreHorizontal, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
    <Card className='group h-full gap-0 rounded-2xl py-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/10'>
      <Link
        to='/director/$category/$projectId'
        params={linkParams}
        className='block'
      >
        <div className='bg-muted relative aspect-[3/4] w-full overflow-hidden'>
          {project.thumbnail ? (
            <img
              src={project.thumbnail}
              alt={project.title}
              className='size-full object-cover transition-transform duration-500 group-hover:scale-105'
            />
          ) : (
            <div className='text-muted-foreground/50 flex size-full items-center justify-center'>
              <Clapperboard aria-hidden='true' className='size-10' />
            </div>
          )}
          {/* 悬停遮罩：暗示点击进入项目 */}
          <div className='absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 backdrop-blur-[2px] transition-opacity duration-300 group-hover:opacity-100'>
            <span className='bg-background/90 text-foreground flex size-11 items-center justify-center rounded-full shadow-lg'>
              <Play aria-hidden='true' className='size-4 fill-current' />
            </span>
          </div>
          <Badge
            variant='secondary'
            className='absolute top-2.5 left-2.5 border-0 bg-black/45 text-white backdrop-blur-sm'
          >
            {t(PROJECT_STATUS_LABEL[project.status] ?? project.status)}
          </Badge>
        </div>
      </Link>
      <div className='flex flex-1 flex-col gap-2 p-3.5'>
        <div className='flex items-center justify-between gap-1.5'>
          <Link
            to='/director/$category/$projectId'
            params={linkParams}
            className='truncate font-semibold tracking-tight hover:underline'
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
        </div>
        {project.genre || project.style ? (
          <div className='flex flex-wrap gap-1'>
            {project.genre && (
              <Badge variant='outline' className='font-normal'>
                {project.genre}
              </Badge>
            )}
            {project.style && (
              <Badge variant='outline' className='font-normal'>
                {project.style}
              </Badge>
            )}
          </div>
        ) : null}
        <p className='text-muted-foreground line-clamp-2 text-xs leading-relaxed'>
          {project.description}
        </p>
        <div className='text-muted-foreground mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs tabular-nums'>
          <span className='truncate'>
            {project.episodeCount} {t('Episodes')} · {project.characterCount}{' '}
            {t('Characters')} · {project.sceneCount} {t('Scenes')}
          </span>
          <span className='shrink-0'>
            {dayjs.unix(project.updatedAt).format('YYYY-MM-DD')}
          </span>
        </div>
      </div>
    </Card>
  )
}
