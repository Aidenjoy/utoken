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
import { Images, RotateCcw, Settings2, Upload } from 'lucide-react'
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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsAdmin } from '@/hooks/use-admin'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import {
  deleteDirectorAsset,
  getDirectorAssetCategories,
  getDirectorAssets,
  getDirectorEpisodes,
  getDirectorProjects,
  uploadDirectorAsset,
} from './api'
import { AssetCard } from './components/asset-card'
import { AssetCategoryDialog } from './components/asset-category-dialog'
import { OwnerFilter } from './components/owner-filter'
import { type OwnerSelection, ownerUserIdParam } from './lib/owner'
import { ASSET_TYPE_OPTIONS, BUILTIN_ASSET_CATEGORIES } from './constants'
import type { DirectorAsset } from './types'

const PAGE_SIZE = 24
const ALL = '__all__'

// 骨架屏占位（静态数组避免索引 key）
const SKELETON_KEYS = [
  's1',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  's8',
  's9',
  's10',
  's11',
  's12',
]

export function DirectorAssetsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isAdmin = useIsAdmin()

  const [page, setPage] = React.useState(1)
  const [projectId, setProjectId] = React.useState<number | null>(null)
  const [episodeId, setEpisodeId] = React.useState<number | null>(null)
  const [type, setType] = React.useState('')
  const [category, setCategory] = React.useState('')
  // 管理员归属筛选：默认自己，可选全部或指定用户（非管理员恒为 self，不下发参数）
  const [owner, setOwner] = React.useState<OwnerSelection>({ kind: 'self' })
  const ownerKey = owner.kind === 'user' ? `user:${owner.id}` : owner.kind
  const ownerUserId = ownerUserIdParam(owner, isAdmin)
  const [uploading, setUploading] = React.useState(false)
  const [catDialogOpen, setCatDialogOpen] = React.useState(false)
  const [deletingAsset, setDeletingAsset] = React.useState<DirectorAsset | null>(
    null
  )
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // 项目 / 分集 / 自定义分类选项
  const { data: projectsData } = useQuery({
    queryKey: ['director', 'projects', 'asset-filter', isAdmin, ownerKey],
    queryFn: () =>
      getDirectorProjects({ p: 1, page_size: 999, userId: ownerUserId }),
  })
  const projects = projectsData?.data?.list ?? []

  const { data: episodesData } = useQuery({
    queryKey: ['director', 'episodes', 'asset-filter', projectId],
    queryFn: () =>
      getDirectorEpisodes({ projectId: projectId as number, page_size: 999 }),
    enabled: projectId !== null,
  })
  const episodes = episodesData?.data?.list ?? []

  const { data: catsData } = useQuery({
    queryKey: ['director', 'asset-categories'],
    queryFn: getDirectorAssetCategories,
  })
  const customCats = catsData?.data ?? []

  // 素材列表
  const { data, isPending } = useQuery({
    queryKey: [
      'director',
      'assets',
      projectId,
      episodeId,
      type,
      category,
      page,
      isAdmin,
      ownerKey,
    ],
    queryFn: () =>
      getDirectorAssets({
        projectId: projectId ?? undefined,
        episodeId: episodeId ?? undefined,
        type: type || undefined,
        category: category || undefined,
        userId: ownerUserId,
        p: page,
        page_size: PAGE_SIZE,
      }),
  })
  const list = data?.data?.list ?? []
  const total = data?.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)

  const invalidateAssets = () => {
    queryClient.invalidateQueries({ queryKey: ['director', 'assets'] })
  }

  // 分类标签（筛选用：含「全部」；移动用：内置 + 自定义）
  const builtinCats = BUILTIN_ASSET_CATEGORIES.map((c) => ({
    key: c.key,
    label: t(c.label),
  }))
  const customCatOptions = customCats.map((c) => ({
    key: c.name,
    label: c.name,
  }))
  const filterCats = [
    { key: '', label: t('All') },
    ...builtinCats,
    ...customCatOptions,
  ]
  const movableCats = [...builtinCats, ...customCatOptions]

  const categoryLabel = (key: string) => {
    const hit = movableCats.find((c) => c.key === key)
    return hit ? hit.label : key || t('Other')
  }

  const projectText = (id?: number | null) => {
    const hit = projects.find((p) => p.id === id)
    return hit ? `#${hit.id} ${hit.title}` : t('Global Asset')
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDirectorAsset(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Deleted'))
        setDeletingAsset(null)
        invalidateAssets()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    },
    onError: handleServerError,
  })

  // 手动上传素材：关联当前筛选的项目/分集/分类
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadDirectorAsset({
        file,
        projectId: projectId ?? undefined,
        episodeId: episodeId ?? undefined,
        category: category || undefined,
      })
      if (res.success) {
        toast.success(t('Uploaded'))
        invalidateAssets()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    } catch (err) {
      handleServerError(err)
    } finally {
      setUploading(false)
    }
  }

  const onProjectChange = (value: string | null) => {
    setProjectId(!value || value === ALL ? null : Number(value))
    setEpisodeId(null)
    setPage(1)
  }

  // 归属切换后项目/分集选项随之变化，需清空已选项
  const onOwnerChange = (v: OwnerSelection) => {
    setOwner(v)
    setProjectId(null)
    setEpisodeId(null)
    setPage(1)
  }

  const onReset = () => {
    setProjectId(null)
    setEpisodeId(null)
    setType('')
    setCategory('')
    setPage(1)
  }

  const renderGrid = () => {
    if (isPending) {
      return (
        <div className='grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className='h-52 rounded-xl' />
          ))}
        </div>
      )
    }
    if (list.length === 0) {
      return (
        <Empty className='mt-16'>
          <EmptyMedia>
            <Images aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No assets yet')}</EmptyTitle>
          <EmptyDescription>
            {t('Upload images, videos or audio to build your asset library')}
          </EmptyDescription>
        </Empty>
      )
    }
    return (
      <div className='grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {list.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            categoryLabel={categoryLabel}
            projectText={projectText}
            showOwner={isAdmin}
            onDelete={setDeletingAsset}
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Asset Library')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden='true' />
            {uploading ? t('Uploading...') : t('Upload Asset')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*,video/*,audio/*'
            className='hidden'
            onChange={(e) => {
              void handleUpload(e)
            }}
          />

          {/* 筛选区 */}
          <div className='mb-4 flex flex-wrap items-center gap-2'>
            {isAdmin && <OwnerFilter value={owner} onChange={onOwnerChange} />}
            <Select
              value={projectId === null ? ALL : String(projectId)}
              onValueChange={onProjectChange}
              items={[
                { value: ALL, label: t('All Projects') },
                ...projects.map((p) => ({
                  value: String(p.id),
                  label: `#${p.id} ${p.title}`,
                })),
              ]}
            >
              <SelectTrigger className='w-52'>
                <SelectValue placeholder={t('All Projects')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('All Projects')}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    #{p.id} {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={episodeId === null ? ALL : String(episodeId)}
              onValueChange={(v) => {
                setEpisodeId(!v || v === ALL ? null : Number(v))
                setPage(1)
              }}
              disabled={projectId === null}
              items={[
                { value: ALL, label: t('All Episodes') },
                ...episodes.map((ep) => ({
                  value: String(ep.id),
                  label: t('Episode {{number}}', {
                    number: ep.episodeNumber,
                  }),
                })),
              ]}
            >
              <SelectTrigger className='w-36'>
                <SelectValue placeholder={t('All Episodes')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('All Episodes')}</SelectItem>
                {episodes.map((ep) => (
                  <SelectItem key={ep.id} value={String(ep.id)}>
                    {t('Episode {{number}}', { number: ep.episodeNumber })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={type === '' ? ALL : type}
              onValueChange={(v) => {
                setType(!v || v === ALL ? '' : v)
                setPage(1)
              }}
              items={[
                { value: ALL, label: t('All Types') },
                ...ASSET_TYPE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: t(o.label),
                })),
              ]}
            >
              <SelectTrigger className='w-32'>
                <SelectValue placeholder={t('All Types')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('All Types')}</SelectItem>
                {ASSET_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant='outline' onClick={onReset}>
              <RotateCcw aria-hidden='true' />
              {t('Reset')}
            </Button>
          </div>

          {/* 分类筛选 */}
          <div className='mb-4 flex flex-wrap items-center gap-2'>
            {filterCats.map((c) => (
              <button
                key={c.key || ALL}
                type='button'
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  category === c.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                )}
                onClick={() => {
                  setCategory(c.key)
                  setPage(1)
                }}
              >
                {c.label}
              </button>
            ))}
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setCatDialogOpen(true)}
            >
              <Settings2 aria-hidden='true' />
              {t('Manage Categories')}
            </Button>
          </div>

          <div className='text-muted-foreground mb-4 text-xs'>
            {t(
              'Supports image / video / audio. Uploaded files are registered to the asset library under the current filters.'
            )}
          </div>

          {renderGrid()}

          {totalPages > 1 && (
            <Pagination className='mt-6'>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    className={cn(
                      page <= 1 && 'pointer-events-none opacity-50'
                    )}
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

      <AssetCategoryDialog
        open={catDialogOpen}
        onOpenChange={setCatDialogOpen}
        categories={customCats}
        onChanged={invalidateAssets}
      />

      {/* 删除素材确认 */}
      <AlertDialog
        open={Boolean(deletingAsset)}
        onOpenChange={(open) => {
          if (!open) setDeletingAsset(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Asset')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Delete this asset? This action cannot be undone.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive hover:bg-destructive/90 text-white'
              onClick={() => {
                if (deletingAsset) {
                  if (page > 1 && list.length === 1) {
                    // 删除当前页最后一条时回退一页
                    setPage((p) => p - 1)
                  }
                  deleteMutation.mutate(deletingAsset.id)
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
