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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createDirectorAssetCategory,
  deleteDirectorAssetCategory,
  updateDirectorAssetCategory,
} from '../api'
import type { DirectorAssetCategory } from '../types'

interface AssetCategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: DirectorAssetCategory[]
  /** 分类增删改后需要刷新素材列表与分类筛选 */
  onChanged: () => void
}

export function AssetCategoryDialog(props: AssetCategoryDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [newName, setNewName] = React.useState('')
  const [renaming, setRenaming] = React.useState<DirectorAssetCategory | null>(
    null
  )
  const [renameValue, setRenameValue] = React.useState('')
  const [deleting, setDeleting] = React.useState<DirectorAssetCategory | null>(
    null
  )

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['director', 'asset-categories'] })
    props.onChanged()
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => createDirectorAssetCategory(name),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Created'))
        setNewName('')
        invalidate()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    },
    onError: handleServerError,
  })

  const renameMutation = useMutation({
    mutationFn: (params: { id: number; name: string }) =>
      updateDirectorAssetCategory(params),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Renamed'))
        setRenaming(null)
        invalidate()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDirectorAssetCategory(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Deleted'))
        setDeleting(null)
        invalidate()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    },
    onError: handleServerError,
  })

  const submitCreate = () => {
    const name = newName.trim()
    if (!name) {
      toast.error(t('Category name is required'))
      return
    }
    createMutation.mutate(name)
  }

  const submitRename = () => {
    if (!renaming) return
    const name = renameValue.trim()
    if (!name) {
      toast.error(t('Category name is required'))
      return
    }
    renameMutation.mutate({ id: renaming.id, name })
  }

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('Manage Custom Categories')}</DialogTitle>
          </DialogHeader>
          <div className='flex gap-2'>
            <Input
              value={newName}
              maxLength={20}
              placeholder={t('Enter a new category name, e.g. Poster')}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreate()
              }}
            />
            <Button
              disabled={createMutation.isPending}
              onClick={submitCreate}
            >
              {t('Add')}
            </Button>
          </div>
          {props.categories.length === 0 ? (
            <div className='text-muted-foreground py-6 text-center text-sm'>
              {t('No custom categories yet')}
            </div>
          ) : (
            <div className='divide-border/60 max-h-72 divide-y overflow-y-auto'>
              {props.categories.map((cat) => (
                <div
                  key={cat.id}
                  className='flex items-center justify-between py-2'
                >
                  <span className='truncate text-sm'>{cat.name}</span>
                  <span className='flex shrink-0 gap-1'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        setRenaming(cat)
                        setRenameValue(cat.name)
                      }}
                    >
                      {t('Rename')}
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:text-destructive'
                      onClick={() => setDeleting(cat)}
                    >
                      {t('Delete')}
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 重命名分类 */}
      <Dialog
        open={Boolean(renaming)}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
      >
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>{t('Rename Category')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            maxLength={20}
            placeholder={t('Please enter a new category name')}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
            }}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setRenaming(null)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={renameMutation.isPending}
              onClick={submitRename}
            >
              {t('Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除分类确认 */}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Category')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Assets under category "{{name}}" will become uncategorized. Delete?',
                { name: deleting?.name ?? '' }
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
              {deleteMutation.isPending ? t('Deleting...') : t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
