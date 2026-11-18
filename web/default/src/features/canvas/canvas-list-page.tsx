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
import { useNavigate } from '@tanstack/react-router'
import {
  Copy,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Workflow,
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
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createCanvasProject,
  deleteCanvasProject,
  duplicateCanvasProject,
  getCanvasProjects,
  updateCanvasProject,
} from './api'
import type { CanvasProject } from './types'

const PAGE_SIZE = 24
const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']

function isVideoCover(url: string) {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

// 项目卡片：封面预览 + 标题 + 节点数/更新时间 + 操作菜单（打开/重命名/副本/删除）
function CanvasProjectCard(props: {
  project: CanvasProject
  onRename: (project: CanvasProject) => void
  onDuplicate: (project: CanvasProject) => void
  onDelete: (project: CanvasProject) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { project } = props
  const open = () =>
    navigate({ to: '/canvas/$id', params: { id: String(project.id) } })

  let cover: React.ReactNode
  if (!project.coverUrl) {
    cover = (
      <div
        className='text-muted-foreground/40 flex size-full items-center justify-center'
        style={{
          backgroundImage:
            'radial-gradient(circle, currentColor 0.8px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        <Workflow aria-hidden='true' className='size-10' />
      </div>
    )
  } else if (isVideoCover(project.coverUrl)) {
    cover = (
      <video
        src={project.coverUrl}
        muted
        playsInline
        preload='metadata'
        className='size-full object-cover transition-transform duration-500 group-hover:scale-105'
      />
    )
  } else {
    cover = (
      <img
        src={project.coverUrl}
        alt={project.title}
        loading='lazy'
        className='size-full object-cover transition-transform duration-500 group-hover:scale-105'
      />
    )
  }

  return (
    <Card className='group h-full gap-0 overflow-hidden rounded-xl py-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/10'>
      <button
        type='button'
        onClick={open}
        className='bg-muted relative block aspect-[4/3] w-full cursor-pointer overflow-hidden text-left'
        aria-label={t('Open canvas')}
      >
        {cover}
        <div className='absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 backdrop-blur-[2px] transition-opacity duration-300 group-hover:opacity-100'>
          <span className='bg-background/90 text-foreground flex size-9 items-center justify-center rounded-full shadow-lg'>
            <FolderOpen aria-hidden='true' className='size-4' />
          </span>
        </div>
      </button>
      <div className='flex flex-1 flex-col gap-1.5 p-2.5'>
        <div className='flex items-center justify-between gap-1.5'>
          <button
            type='button'
            onClick={open}
            className='truncate text-sm font-semibold tracking-tight hover:underline'
          >
            {project.title}
          </button>
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
              <DropdownMenuItem onClick={open}>
                <FolderOpen aria-hidden='true' />
                {t('Open')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onRename(project)}>
                <Pencil aria-hidden='true' />
                {t('Rename')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onDuplicate(project)}>
                <Copy aria-hidden='true' />
                {t('Duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant='destructive'
                onClick={() => props.onDelete(project)}
              >
                <Trash2 aria-hidden='true' />
                {t('Delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className='text-muted-foreground border-border/60 mt-auto flex items-center justify-between gap-2 border-t pt-2 text-xs tabular-nums'>
          <span>
            {project.nodeCount} {t('nodes')}
          </span>
          <span className='shrink-0'>
            {dayjs.unix(project.updatedAt).format('YYYY-MM-DD HH:mm')}
          </span>
        </div>
      </div>
    </Card>
  )
}

export function CanvasListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [page, setPage] = React.useState(1)
  const [keyword, setKeyword] = React.useState('')
  const debouncedKeyword = useDebounce(keyword, 400)
  const [renaming, setRenaming] = React.useState<CanvasProject | null>(null)
  const [renameValue, setRenameValue] = React.useState('')
  const [deleting, setDeleting] = React.useState<CanvasProject | null>(null)
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    setPage(1)
  }, [debouncedKeyword])

  const { data, isPending } = useQuery({
    queryKey: ['canvas', 'projects', page, debouncedKeyword],
    queryFn: () =>
      getCanvasProjects({
        keyword: debouncedKeyword || undefined,
        p: page,
        page_size: PAGE_SIZE,
      }),
  })
  const list = data?.data?.list ?? []
  const total = data?.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['canvas', 'projects'] })

  // 创建即进入画布（与 BeefTV 一致：创建卡/按钮直接落到编辑器）
  const createMutation = useMutation({
    mutationFn: () => createCanvasProject(t('Untitled canvas')),
    onSuccess: (res) => {
      if (res.success && res.data) {
        invalidate()
        navigate({ to: '/canvas/$id', params: { id: String(res.data.id) } })
      }
      setCreating(false)
    },
    onError: (err) => {
      setCreating(false)
      handleServerError(err)
    },
  })

  const renameMutation = useMutation({
    mutationFn: (body: { id: number; title: string }) =>
      updateCanvasProject(body),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Project renamed'))
        setRenaming(null)
        invalidate()
      }
    },
    onError: handleServerError,
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => duplicateCanvasProject(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Project duplicated'))
        invalidate()
      }
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCanvasProject(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Project deleted'))
        setDeleting(null)
        invalidate()
      }
    },
    onError: handleServerError,
  })

  const renderGrid = () => {
    if (isPending) {
      return (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
          {SKELETON_KEYS.map((key) => (
            <div key={key} className='space-y-2.5'>
              <Skeleton className='aspect-[4/3] w-full rounded-xl' />
              <Skeleton className='h-4 w-2/3' />
              <Skeleton className='h-3 w-1/2' />
            </div>
          ))}
        </div>
      )
    }
    return (
      <>
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
          {/* 创建卡：始终位于网格首位 */}
          <button
            type='button'
            disabled={creating}
            onClick={() => createMutation.mutate()}
            className='border-border bg-card hover:border-foreground/40 hover:bg-accent group flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/10 disabled:opacity-60'
          >
            <span className='bg-muted text-muted-foreground group-hover:bg-foreground group-hover:text-background flex size-12 items-center justify-center rounded-full transition-colors duration-300'>
              <Plus aria-hidden='true' className='size-6' />
            </span>
            <span className='text-sm font-semibold'>
              {creating ? t('Creating...') : t('Start creating')}
            </span>
            <span className='text-muted-foreground text-xs'>
              {t('Create a new canvas project')}
            </span>
          </button>
          {list.map((project, index) => (
            <div
              key={project.id}
              className='animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500'
              style={{ animationDelay: `${Math.min(index, 11) * 45}ms` }}
            >
              <CanvasProjectCard
                project={project}
                onRename={(p) => {
                  setRenaming(p)
                  setRenameValue(p.title)
                }}
                onDuplicate={(p) => duplicateMutation.mutate(p.id)}
                onDelete={setDeleting}
              />
            </div>
          ))}
        </div>
        {list.length === 0 && (
          <Empty className='mt-10'>
            <EmptyMedia>
              <Workflow aria-hidden='true' />
            </EmptyMedia>
            <EmptyTitle>
              {t('Let your first idea land on the canvas')}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                'Add text, image and video nodes, connect them to build your creative flow, and generate with AI.'
              )}
            </EmptyDescription>
          </Empty>
        )}
      </>
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
              className='w-56 pl-8'
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('Search projects...')}
            />
          </div>
          <Button disabled={creating} onClick={() => createMutation.mutate()}>
            <Plus aria-hidden='true' />
            {t('Create Project')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          {renderGrid()}
          {totalPages > 1 && (
            <div className='mt-6 flex items-center justify-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('Previous')}
              </Button>
              <span className='text-muted-foreground text-sm tabular-nums'>
                {page} / {totalPages}
              </span>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('Next')}
              </Button>
            </div>
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>

      {/* 重命名弹窗 */}
      <Dialog
        open={Boolean(renaming)}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
      >
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>{t('Rename Project')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={t('Project name')}
            maxLength={64}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renaming && renameValue.trim()) {
                renameMutation.mutate({
                  id: renaming.id,
                  title: renameValue.trim(),
                })
              }
            }}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setRenaming(null)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={!renameValue.trim() || renameMutation.isPending}
              onClick={() => {
                if (renaming) {
                  renameMutation.mutate({
                    id: renaming.id,
                    title: renameValue.trim(),
                  })
                }
              }}
            >
              {renameMutation.isPending ? t('Saving...') : t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Project')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This will permanently delete the canvas project and all its nodes, connections and generation records. This action cannot be undone.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive hover:bg-destructive/90 text-white'
              onClick={() => {
                if (deleting) {
                  if (page > 1 && list.length === 1) setPage((p) => p - 1)
                  deleteMutation.mutate(deleting.id)
                }
              }}
            >
              {deleteMutation.isPending ? t('Deleting...') : t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
