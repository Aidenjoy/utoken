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
import { ArrowLeft, Clapperboard, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
      return <Skeleton className='h-28 w-full' />
    }
    if (!project) {
      return null
    }
    return (
      <Card>
        <CardContent className='flex gap-4 py-4'>
          <div className='bg-muted relative h-[90px] w-[120px] shrink-0 overflow-hidden rounded-md'>
            {project.thumbnail ? (
              <ZoomableImage
                src={project.thumbnail}
                alt={project.title}
                className='size-full'
              />
            ) : (
              <div className='text-muted-foreground flex size-full items-center justify-center'>
                <Clapperboard aria-hidden='true' className='size-7' />
              </div>
            )}
          </div>
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <h1 className='text-lg font-semibold'>{project.title}</h1>
              <Badge variant='secondary'>
                {t(PROJECT_STATUS_LABEL[project.status] ?? project.status)}
              </Badge>
              {categoryConfig.showGenre && project.genre ? (
                <Badge variant='outline'>{project.genre}</Badge>
              ) : null}
            </div>
            <p className='text-muted-foreground mt-2 line-clamp-2 text-sm'>
              {project.description || t('No description')}
            </p>
            <div className='text-muted-foreground mt-2 flex flex-wrap gap-4 text-xs'>
              <span>
                {t('Planned')} {project.totalEpisodes} {t(categoryConfig.itemUnit)}
              </span>
              <span>
                {t('Style')}: {project.style || '-'}
              </span>
              <span>
                {t('Updated at')} {dayjs.unix(project.updatedAt).format('YYYY-MM-DD HH:mm')}
              </span>
            </div>
          </div>
          <div className='flex shrink-0 flex-col gap-2'>
            <Button variant='outline' onClick={() => setEditProjectOpen(true)}>
              <Pencil aria-hidden='true' />
              {t('Edit Project')}
            </Button>
            <Button
              variant='outline'
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
        <div className='space-y-2'>
          <Skeleton className='h-12 w-full' />
          <Skeleton className='h-12 w-full' />
        </div>
      )
    }
    if (episodes.length === 0) {
      return (
        <div className='text-muted-foreground py-8 text-center text-sm'>
          {t('No episodes yet')}
        </div>
      )
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-16 text-center'>
              {t('Episode Number')}
            </TableHead>
            <TableHead>{t('Title')}</TableHead>
            <TableHead className='w-24 text-center'>{t('Status')}</TableHead>
            <TableHead className='w-20 text-center'>{t('Duration')}</TableHead>
            <TableHead className='w-32'>{t('Created At')}</TableHead>
            <TableHead className='w-56 text-right'>{t('Actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {episodes.map((episode) => (
            <TableRow key={episode.id}>
              <TableCell className='text-center'>
                {episode.episodeNumber}
              </TableCell>
              <TableCell className='max-w-0'>
                <Link
                  to='/director/$category/$projectId/episode/$episodeId'
                  params={{
                    category: props.category,
                    projectId: String(props.projectId),
                    episodeId: String(episode.id),
                  }}
                  className='truncate font-medium hover:underline'
                >
                  {episode.title}
                </Link>
              </TableCell>
              <TableCell className='text-center'>
                <Badge variant='secondary'>
                  {t(PROJECT_STATUS_LABEL[episode.status] ?? episode.status)}
                </Badge>
              </TableCell>
              <TableCell className='text-center'>
                {episode.duration ? `${episode.duration}s` : '-'}
              </TableCell>
              <TableCell>
                {dayjs.unix(episode.createdAt).format('YYYY-MM-DD HH:mm')}
              </TableCell>
              <TableCell className='text-right'>
                <div className='flex justify-end gap-1'>
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
            <Card>
              <CardContent className='py-4'>
                <h2 className='mb-3 text-base font-semibold'>
                  {t('Episode List')}
                </h2>
                {renderEpisodes()}
              </CardContent>
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
