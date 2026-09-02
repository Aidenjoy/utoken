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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Film, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createDirectorEpisode,
  deleteDirectorEpisode,
  deleteDirectorProject,
  getDirectorEpisodes,
  getDirectorProject,
} from './api'
import { DIRECTOR_CATEGORY_CONFIG } from './constants'
import type { DirectorCategory, DirectorEpisode } from './types'

interface ProjectDetailPageProps {
  category: DirectorCategory
  projectId: number
}

export function ProjectDetailPage(props: ProjectDetailPageProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const categoryConfig = DIRECTOR_CATEGORY_CONFIG[props.category]

  const [deletingEpisode, setDeletingEpisode] =
    React.useState<DirectorEpisode | null>(null)
  const [deletingProject, setDeletingProject] = React.useState(false)

  const projectQuery = useQuery({
    queryKey: ['director', 'project', props.projectId],
    queryFn: () => getDirectorProject(props.projectId),
  })

  const episodesQuery = useQuery({
    queryKey: ['director', 'episodes', props.projectId],
    queryFn: () =>
      getDirectorEpisodes({ projectId: props.projectId, page_size: 200 }),
  })

  const createEpisodeMutation = useMutation({
    mutationFn: () =>
      createDirectorEpisode({ projectId: props.projectId } as DirectorEpisode),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Episode created'))
        queryClient.invalidateQueries({
          queryKey: ['director', 'episodes', props.projectId],
        })
      }
    },
    onError: handleServerError,
  })

  const deleteEpisodeMutation = useMutation({
    mutationFn: (id: number) => deleteDirectorEpisode(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Episode deleted'))
        setDeletingEpisode(null)
        queryClient.invalidateQueries({
          queryKey: ['director', 'episodes', props.projectId],
        })
      }
    },
    onError: handleServerError,
  })

  const deleteProjectMutation = useMutation({
    mutationFn: () => deleteDirectorProject(props.projectId),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Project deleted'))
        window.history.back()
      }
    },
    onError: handleServerError,
  })

  const project = projectQuery.data?.data
  const episodes = episodesQuery.data?.data?.list ?? []

  const renderProjectInfo = () => {
    if (projectQuery.isPending) {
      return <Skeleton className='h-24 w-full' />
    }
    if (!project) {
      return null
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>{project.title}</CardTitle>
          <CardDescription>{project.description}</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap items-center gap-2 text-sm'>
          <Badge variant='secondary'>{t(categoryConfig.label)}</Badge>
          {project.genre && <Badge variant='outline'>{project.genre}</Badge>}
          {project.style && <Badge variant='outline'>{project.style}</Badge>}
          <span className='text-muted-foreground'>
            {t('Total Episodes')}: {project.totalEpisodes}
          </span>
        </CardContent>
      </Card>
    )
  }

  const renderEpisodes = () => {
    if (episodesQuery.isPending) {
      return (
        <div className='space-y-2'>
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-16 w-full' />
        </div>
      )
    }
    if (episodes.length === 0) {
      return (
        <Empty>
          <EmptyMedia>
            <Film aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No episodes yet')}</EmptyTitle>
          <EmptyDescription>
            {t('Add an episode to start creating content')}
          </EmptyDescription>
        </Empty>
      )
    }
    return (
      <div className='space-y-2'>
        {episodes.map((episode) => (
          <Card key={episode.id}>
            <CardContent className='flex items-center justify-between gap-4 py-4'>
              <Link
                to='/director/$category/$projectId/episode/$episodeId'
                params={{
                  category: props.category,
                  projectId: String(props.projectId),
                  episodeId: String(episode.id),
                }}
                className='flex min-w-0 flex-1 items-center gap-3 hover:underline'
              >
                <Badge variant='outline' className='shrink-0'>
                  {episode.episodeNumber}
                </Badge>
                <span className='truncate font-medium'>{episode.title}</span>
                {episode.videoUrl ? (
                  <Badge variant='secondary'>{t('Completed')}</Badge>
                ) : null}
              </Link>
              <Button
                variant='ghost'
                size='icon'
                aria-label={t('Delete Episode')}
                onClick={() => setDeletingEpisode(episode)}
              >
                <Trash2 aria-hidden='true' className='size-4' />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Breadcrumb>
        <Link
          to='/director/$category'
          params={{ category: props.category }}
          className='text-muted-foreground hover:text-foreground flex items-center gap-1'
        >
          <ArrowLeft aria-hidden='true' className='size-4' />
          {t(categoryConfig.label)}
        </Link>
      </SectionPageLayout.Breadcrumb>
      <SectionPageLayout.Title>
        {project?.title ?? t('Project Detail')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          onClick={() => createEpisodeMutation.mutate()}
          disabled={createEpisodeMutation.isPending}
        >
          <Plus aria-hidden='true' />
          {t('Add Episode')}
        </Button>
        <Button
          variant='outline'
          className='text-destructive hover:text-destructive'
          onClick={() => setDeletingProject(true)}
        >
          <Trash2 aria-hidden='true' />
          {t('Delete Project')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-6'>
          {renderProjectInfo()}

          <div className='space-y-3'>
            <h2 className='text-lg font-semibold'>{t('Episodes')}</h2>
            {renderEpisodes()}
          </div>
        </div>
      </SectionPageLayout.Content>

      <AlertDialog
        open={Boolean(deletingEpisode)}
        onOpenChange={(open) => {
          if (!open) setDeletingEpisode(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Episode')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This will permanently delete the episode and its storyboards. This action cannot be undone.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive hover:bg-destructive/90 text-white'
              onClick={() => {
                if (deletingEpisode) {
                  deleteEpisodeMutation.mutate(deletingEpisode.id)
                }
              }}
            >
              {deleteEpisodeMutation.isPending ? t('Deleting...') : t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deletingProject} onOpenChange={setDeletingProject}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Project')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This will permanently delete the project and all its episodes, storyboards and generated assets. This action cannot be undone.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive hover:bg-destructive/90 text-white'
              onClick={() => deleteProjectMutation.mutate()}
            >
              {deleteProjectMutation.isPending ? t('Deleting...') : t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionPageLayout>
  )
}
