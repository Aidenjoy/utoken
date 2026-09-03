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
import { Clapperboard, Plus, Search } from 'lucide-react'
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
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/hooks'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { deleteDirectorProject, getDirectorProjects } from './api'
import { ProjectCard } from './components/project-card'
import { ProjectDialog } from './components/project-dialog'
import { DIRECTOR_CATEGORY_CONFIG } from './constants'
import type { DirectorCategory, DirectorProjectWithStats } from './types'

const PAGE_SIZE = 12

// 骨架屏占位（静态数组避免索引 key）
const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']

interface DirectorListPageProps {
  category: DirectorCategory
}

export function DirectorListPage(props: DirectorListPageProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const categoryConfig = DIRECTOR_CATEGORY_CONFIG[props.category]

  const [page, setPage] = React.useState(1)
  const [keyword, setKeyword] = React.useState('')
  const debouncedKeyword = useDebounce(keyword, 400)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingProject, setEditingProject] =
    React.useState<DirectorProjectWithStats | null>(null)
  const [deletingProject, setDeletingProject] =
    React.useState<DirectorProjectWithStats | null>(null)

  React.useEffect(() => {
    setPage(1)
  }, [props.category, debouncedKeyword])

  const { data, isPending } = useQuery({
    queryKey: ['director', 'projects', props.category, page, debouncedKeyword],
    queryFn: () =>
      getDirectorProjects({
        category: props.category,
        keyword: debouncedKeyword || undefined,
        p: page,
        page_size: PAGE_SIZE,
      }),
  })

  const list = data?.data?.list ?? []
  const total = data?.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDirectorProject(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Project deleted'))
        setDeletingProject(null)
        queryClient.invalidateQueries({
          queryKey: ['director', 'projects', props.category],
        })
      }
    },
    onError: handleServerError,
  })

  const renderProjects = () => {
    if (isPending) {
      return (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className='h-56 rounded-xl' />
          ))}
        </div>
      )
    }
    if (list.length === 0) {
      return (
        <Empty className='mt-16'>
          <EmptyMedia>
            <Clapperboard aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No projects yet')}</EmptyTitle>
          <EmptyDescription>
            {t('Create your first project to start the production pipeline')}
          </EmptyDescription>
        </Empty>
      )
    }
    return (
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {list.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            category={props.category}
            onEdit={(p) => {
              setEditingProject(p)
              setDialogOpen(true)
            }}
            onDelete={setDeletingProject}
          />
        ))}
      </div>
    )
  }

  return (
    <>
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t(categoryConfig.label)}
      </SectionPageLayout.Title>
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
        <Button
          onClick={() => {
            setEditingProject(null)
            setDialogOpen(true)
          }}
        >
          <Plus aria-hidden='true' />
          {t('Create Project')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {renderProjects()}

        {totalPages > 1 && (
          <Pagination className='mt-6'>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  className={cn(page <= 1 && 'pointer-events-none opacity-50')}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                />
              </PaginationItem>
              {pageNumbers.map((num) => (
                <PaginationItem key={num}>
                  <PaginationLink
                    isActive={page === num}
                    onClick={() => setPage(num)}
                  >
                    {num}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  className={cn(
                    page >= totalPages && 'pointer-events-none opacity-50'
                  )}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>

    <ProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        category={props.category}
        project={editingProject}
        onSaved={() => {
          queryClient.invalidateQueries({
            queryKey: ['director', 'projects', props.category],
          })
        }}
      />

      <AlertDialog
        open={Boolean(deletingProject)}
        onOpenChange={(open) => {
          if (!open) setDeletingProject(null)
        }}
      >
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
              onClick={() => {
                if (deletingProject) {
                  if (page > 1 && list.length === 1) {
                    // 删除当前页最后一条时回退一页
                    setPage((p) => p - 1)
                  }
                  deleteMutation.mutate(deletingProject.id)
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
