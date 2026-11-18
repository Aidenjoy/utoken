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
  Ellipsis,
  ImageOff,
  Layers,
  Pencil,
  Plus,
  Search,
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/hooks'

import {
  createProject,
  deleteProject,
  getCapabilities,
  listProjects,
  renameProject,
} from './api'
import {
  CreateProjectDialog,
  RenameProjectDialog,
} from './components/project-dialogs'
import type { CanvasProject } from './types'

// 智能画布：项目列表
// 从侧边栏「智能画布」进入即是这一页，可新建、打开、重命名、删除画布。

const PAGE_SIZE = 12
const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6']

function formatDate(seconds: number): string {
  if (!seconds) return '-'
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function CanvasListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [page, setPage] = React.useState(1)
  const [keyword, setKeyword] = React.useState('')
  const debouncedKeyword = useDebounce(keyword, 400)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [renaming, setRenaming] = React.useState<CanvasProject | null>(null)
  const [deleting, setDeleting] = React.useState<CanvasProject | null>(null)

  React.useEffect(() => {
    setPage(1)
  }, [debouncedKeyword])

  const { data: capabilities } = useQuery({
    queryKey: ['canvas', 'capabilities'],
    queryFn: getCapabilities,
    staleTime: 60_000,
  })

  const { data, isPending } = useQuery({
    queryKey: ['canvas', 'projects', page, debouncedKeyword],
    queryFn: () =>
      listProjects({
        p: page,
        page_size: PAGE_SIZE,
        keyword: debouncedKeyword || undefined,
      }),
  })

  const list = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['canvas', 'projects'] })
  }

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      toast.success(t('Canvas created'))
      setCreateOpen(false)
      invalidate()
      navigate({
        to: '/canvas/$projectId',
        params: { projectId: String(project.id) },
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const renameMutation = useMutation({
    mutationFn: (payload: { id: number; title: string }) =>
      renameProject(payload.id, payload.title),
    onSuccess: () => {
      toast.success(t('Renamed'))
      setRenaming(null)
      invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteProject(id),
    onSuccess: () => {
      toast.success(t('Deleted'))
      setDeleting(null)
      invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const renderProjects = () => {
    if (isPending) {
      return (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4'>
          {SKELETON_KEYS.map((key) => (
            <div key={key} className='overflow-hidden rounded-lg border'>
              <Skeleton className='aspect-square w-full' />
              <div className='space-y-2 p-3'>
                <Skeleton className='h-4 w-2/3' />
                <Skeleton className='h-3 w-1/3' />
              </div>
            </div>
          ))}
        </div>
      )
    }

    if (list.length === 0) {
      return (
        <Empty className='py-16'>
          <EmptyMedia variant='icon'>
            <Layers />
          </EmptyMedia>
          <EmptyTitle>
            {debouncedKeyword
              ? t('No matching canvases')
              : t('No canvases yet')}
          </EmptyTitle>
          <EmptyDescription>
            {t('Create a canvas to start generating and editing images')}
          </EmptyDescription>
          <Button className='mt-4' onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden='true' />
            {t('New canvas')}
          </Button>
        </Empty>
      )
    }

    return (
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4'>
        {list.map((project) => (
          <div
            key={project.id}
            className='group hover:border-primary/50 relative overflow-hidden rounded-lg border transition-colors'
          >
            <Link
              to='/canvas/$projectId'
              params={{ projectId: String(project.id) }}
              className='block'
            >
              <div className='bg-muted/40 flex aspect-square items-center justify-center overflow-hidden'>
                {project.thumbnail ? (
                  <img
                    src={project.thumbnail}
                    alt={project.title}
                    className='h-full w-full object-contain'
                    loading='lazy'
                  />
                ) : (
                  <ImageOff className='text-muted-foreground/50' size={28} />
                )}
              </div>
              <div className='px-3 py-2'>
                <p className='truncate text-sm font-medium'>{project.title}</p>
                <p className='text-muted-foreground mt-0.5 truncate text-[11px]'>
                  {project.width}×{project.height} ·{' '}
                  {t('{{count}} layers', { count: project.layerCount })} ·{' '}
                  {formatDate(project.updatedAt)}
                </p>
              </div>
            </Link>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size='icon'
                    variant='secondary'
                    className='absolute top-1.5 right-1.5 h-7 w-7 opacity-0 group-hover:opacity-100'
                  >
                    <Ellipsis size={14} />
                  </Button>
                }
              />
              <DropdownMenuContent align='end'>
                <DropdownMenuItem
                  onClick={() => setRenaming(project)}
                  className='gap-2'
                >
                  <Pencil size={13} />
                  {t('Rename')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => setDeleting(project)}
                  className='gap-2'
                >
                  <Trash2 size={13} />
                  {t('Delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Smart Canvas')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <div className='relative'>
            <Search
              aria-hidden='true'
              className='text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
            />
            <Input
              className='w-48 pl-8 sm:w-56'
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('Search canvases...')}
            />
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden='true' />
            {t('New canvas')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          {renderProjects()}

          {totalPages > 1 ? (
            <div className='mt-6 flex items-center justify-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                {t('Previous')}
              </Button>
              <span className='text-muted-foreground text-xs'>
                {page} / {totalPages}
              </span>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= totalPages}
                onClick={() =>
                  setPage((value) => Math.min(totalPages, value + 1))
                }
              >
                {t('Next')}
              </Button>
            </div>
          ) : null}
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        maxSide={capabilities?.maxSide ?? 8192}
        submitting={createMutation.isPending}
        onCreate={(payload) => createMutation.mutate(payload)}
      />

      <RenameProjectDialog
        open={Boolean(renaming)}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
        initialTitle={renaming?.title ?? ''}
        submitting={renameMutation.isPending}
        onRename={(title) => {
          if (renaming) renameMutation.mutate({ id: renaming.id, title })
        }}
      />

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete canvas')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This permanently deletes the canvas, its layers and all task history. Uploaded images stored in object storage are kept.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive hover:bg-destructive/90 text-white'
              onClick={() => {
                if (deleting) deleteMutation.mutate(deleting.id)
              }}
            >
              {t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
