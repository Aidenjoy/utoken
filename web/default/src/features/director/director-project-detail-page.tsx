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
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  CalendarDays,
  Clapperboard,
  Clock,
  Film,
  Palette,
  Pencil,
  Plus,
  Timer,
  Trash2,
} from 'lucide-react'
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
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { ZoomableImage } from '@/components/zoomable-image'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'

import {
  deleteDirectorEpisode,
  deleteDirectorProject,
  getDirectorEpisodes,
  getDirectorProject,
} from './api'
import { EpisodeDialog } from './components/episode-dialog'
import { ProjectDialog } from './components/project-dialog'
import {
  DIRECTOR_CATEGORY_CONFIG,
  PROJECT_STATUS_LABEL,
} from './constants'
import type { DirectorCategory, DirectorEpisode } from './types'

interface ProjectDetailPageProps {
  category: DirectorCategory
  projectId: number
}

export function ProjectDetailPage(props: ProjectDetailPageProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const categoryConfig = DIRECTOR_CATEGORY_CONFIG[props.category]

  const [editProjectOpen, setEditProjectOpen] = React.useState(false)
  const [episodeDialogOpen, setEpisodeDialogOpen] = React.useState(false)
  const [editingEpisode, setEditingEpisode] =
    React.useState<DirectorEpisode | null>(null)
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
        navigate({
          to: '/director/$category',
          params: { category: props.category },
        })
      }
    },
    onError: handleServerError,
  })

  const project = projectQuery.data?.data
  const episodes = episodesQuery.data?.data?.list ?? []
  const nextEpisodeNumber = episodes.length + 1

  const invalidateProject = () => {
    queryClient.invalidateQueries({
      queryKey: ['director', 'project', props.projectId],
    })
    queryClient.invalidateQueries({
      queryKey: ['director', 'projects'],
    })
    queryClient.invalidateQueries({
      queryKey: ['director', 'episodes', props.projectId],
    })
  }

  // 编辑项目后若类别变更，跳转到新类别的列表页
  const handleProjectSaved = () => {
    invalidateProject()
    if (project && project.category !== props.category) {
      navigate({
        to: '/director/$category',
        params: { category: project.category },
      })
    }
  }

  const openCreateEpisode = () => {
    setEditingEpisode(null)
    setEpisodeDialogOpen(true)
  }

  const openEditEpisode = (episode: DirectorEpisode) => {
    setEditingEpisode(episode)
    setEpisodeDialogOpen(true)
  }

  const renderOverview = () => {
    if (projectQuery.isPending) {
      return <Skeleton className='h-70 w-full rounded-2xl' />
    }
    if (!project) {
      return null
    }
    return (
      <Card className='gap-0 rounded-2xl py-0'>
        <CardContent className='flex flex-col gap-5 p-5 md:flex-row'>
          <div className='bg-muted relative aspect-[3/4] w-36 shrink-0 overflow-hidden rounded-xl ring-1 ring-foreground/10 md:w-44'>
            {project.thumbnail ? (
              <ZoomableImage
                src={project.thumbnail}
                alt={project.title}
                className='size-full object-cover'
              />
            ) : (
              <div className='text-muted-foreground/50 flex size-full items-center justify-center'>
                <Clapperboard aria-hidden='true' className='size-9' />
              </div>
            )}
          </div>
          <div className='min-w-0 flex-1 space-y-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <Badge variant='secondary'>
                {t(PROJECT_STATUS_LABEL[project.status] ?? project.status)}
              </Badge>
              {categoryConfig.showGenre && project.genre ? (
                <Badge variant='outline' className='font-normal'>
                  {project.genre}
                </Badge>
              ) : null}
            </div>
            <p className='text-muted-foreground line-clamp-3 text-sm leading-relaxed'>
              {project.description || t('No description')}
            </p>
            <div className='flex flex-wrap gap-2'>
              <span className='bg-muted text-muted-foreground flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs tabular-nums'>
                <Film aria-hidden='true' className='size-3.5' />
                {t('Planned')} {project.totalEpisodes}{' '}
                {t(categoryConfig.itemUnit)}
              </span>
              <span className='bg-muted text-muted-foreground flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs'>
                <Palette aria-hidden='true' className='size-3.5' />
                {t('Style')}: {project.style || '-'}
              </span>
              <span className='bg-muted text-muted-foreground flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs tabular-nums'>
                <Clock aria-hidden='true' className='size-3.5' />
                {t('Updated at')}{' '}
                {dayjs.unix(project.updatedAt).format('YYYY-MM-DD HH:mm')}
              </span>
            </div>
          </div>
          <div className='flex shrink-0 gap-2 md:flex-col'>
            <Button variant='outline' onClick={() => setEditProjectOpen(true)}>
              <Pencil aria-hidden='true' />
              {t('Edit Project')}
            </Button>
            <Button
              variant='ghost'
              onClick={() =>
                navigate({
                  to: '/director/$category',
                  params: { category: props.category },
                })
              }
            >
              <ArrowLeft aria-hidden='true' />
              {t('Back to List')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const renderEpisodes = () => {
    if (episodesQuery.isPending) {
      return (
        <div className='space-y-2 p-4'>
          <Skeleton className='h-16 w-full rounded-xl' />
          <Skeleton className='h-16 w-full rounded-xl' />
          <Skeleton className='h-16 w-full rounded-xl' />
        </div>
      )
    }
    if (episodes.length === 0) {
      return (
        <Empty className='py-10'>
          <EmptyMedia>
            <Film aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No episodes yet')}</EmptyTitle>
        </Empty>
      )
    }
    return (
      <div className='divide-y divide-border/60'>
        {episodes.map((episode) => (
          <div
            key={episode.id}
            className='flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/50'
          >
            <div className='bg-muted flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold tabular-nums'>
              {episode.episodeNumber}
            </div>
            <div className='min-w-0 flex-1 basis-40'>
              <Link
                to='/director/$category/$projectId/episode/$episodeId'
                params={{
                  category: props.category,
                  projectId: String(props.projectId),
                  episodeId: String(episode.id),
                }}
                className='block truncate font-medium hover:underline'
              >
                {episode.title}
              </Link>
              <div className='text-muted-foreground mt-1 flex items-center gap-3 text-xs tabular-nums'>
                <span className='flex items-center gap-1'>
                  <CalendarDays aria-hidden='true' className='size-3' />
                  {dayjs.unix(episode.createdAt).format('YYYY-MM-DD HH:mm')}
                </span>
                <span className='flex items-center gap-1'>
                  <Timer aria-hidden='true' className='size-3' />
                  {episode.duration ? `${episode.duration}s` : '-'}
                </span>
              </div>
            </div>
            <Badge variant='secondary' className='shrink-0'>
              {t(PROJECT_STATUS_LABEL[episode.status] ?? episode.status)}
            </Badge>
            <div className='ml-auto flex shrink-0 items-center gap-1'>
              <Button
                variant='outline'
                size='sm'
                onClick={() =>
                  navigate({
                    to: '/director/$category/$projectId/episode/$episodeId',
                    params: {
                      category: props.category,
                      projectId: String(props.projectId),
                      episodeId: String(episode.id),
                    },
                  })
                }
              >
                <Clapperboard aria-hidden='true' />
                {t('Studio')}
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => openEditEpisode(episode)}
              >
                <Pencil aria-hidden='true' />
                {t('Edit')}
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className='text-destructive hover:text-destructive'
                onClick={() => setDeletingEpisode(episode)}
              >
                <Trash2 aria-hidden='true' />
                {t('Delete')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
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
          <Button onClick={openCreateEpisode}>
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
            {renderOverview()}
            <Card className='gap-0 rounded-2xl py-0'>
              <div className='flex items-center justify-between border-b border-border/60 px-4 py-3.5'>
                <h2 className='font-semibold tracking-tight'>
                  {t('Episode List')}
                </h2>
                {episodes.length > 0 && (
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {episodes.length} {t('Episodes')}
                  </span>
                )}
              </div>
              {renderEpisodes()}
            </Card>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ProjectDialog
        open={editProjectOpen}
        onOpenChange={setEditProjectOpen}
        category={props.category}
        project={project}
        onSaved={handleProjectSaved}
      />

      <EpisodeDialog
        open={episodeDialogOpen}
        onOpenChange={setEpisodeDialogOpen}
        category={props.category}
        projectId={props.projectId}
        nextEpisodeNumber={nextEpisodeNumber}
        episode={editingEpisode}
        onSaved={() =>
          queryClient.invalidateQueries({
            queryKey: ['director', 'episodes', props.projectId],
          })
        }
      />

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
    </>
  )
}
