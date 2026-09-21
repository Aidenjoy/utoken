import { Trash2 } from 'lucide-react'
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
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import type { TryOnTask } from '../types'

interface HistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: TryOnTask[]
  onRemove: (taskId: string) => void
  onClear: () => void
}

/** Local generation history; result URLs may expire like playground images. */
export function HistoryDialog(props: HistoryDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[80vh] max-w-2xl overflow-y-auto'>
        <DialogHeader className='flex flex-row items-center justify-between space-y-0'>
          <DialogTitle>{t('History')}</DialogTitle>
          {props.tasks.length > 0 ? (
            <Button variant='ghost' size='sm' onClick={props.onClear}>
              <Trash2 className='size-4' />
              {t('Clear all')}
            </Button>
          ) : null}
        </DialogHeader>
        {props.tasks.length === 0 ? (
          <p className='text-muted-foreground py-8 text-center text-sm'>
            {t('No generation history yet')}
          </p>
        ) : (
          <ul className='space-y-4'>
            {props.tasks.map((task) => (
              <li key={task.id} className='border-border rounded-lg border p-3'>
                <div className='text-muted-foreground mb-2 flex items-center justify-between gap-2 text-xs'>
                  <span>
                    {new Date(task.createdAt).toLocaleString()} ·{' '}
                    {task.imageModel} · {task.size} × {task.count}
                  </span>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('Remove')}
                    className='size-7'
                    onClick={() => props.onRemove(task.id)}
                  >
                    <Trash2 className='size-3.5' />
                  </Button>
                </div>
                {task.error ? (
                  <p className='text-destructive text-xs'>{task.error}</p>
                ) : (
                  <div className='flex flex-wrap gap-2'>
                    {task.results.map((src, index) => (
                      <img
                        key={src}
                        src={src}
                        alt={t('Try-on result {{index}}', { index: index + 1 })}
                        className='border-border size-16 rounded-md border object-cover'
                      />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
