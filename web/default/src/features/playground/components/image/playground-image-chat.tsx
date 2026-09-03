import {
  AlertCircleIcon,
  DownloadIcon,
  ImageIcon,
  LoaderIcon,
  XCircleIcon,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ZoomableImage } from '@/components/zoomable-image'

import type { ImageTask } from '../../types'

interface PlaygroundImageChatProps {
  tasks: ImageTask[]
  onClear?: () => void
}

export function PlaygroundImageChat({
  tasks,
  onClear,
}: PlaygroundImageChatProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the newest task
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [tasks])

  if (tasks.length === 0) {
    return (
      <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-4'>
        <div className='bg-muted/50 flex size-16 items-center justify-center rounded-full'>
          <ImageIcon className='text-muted-foreground' size={28} />
        </div>
        <p className='text-muted-foreground text-sm'>
          {t('Generate images by entering a prompt below')}
        </p>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className='mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-4 py-6'
    >
      <div className='mb-3 flex items-center justify-between'>
        <span className='text-muted-foreground text-sm'>
          {tasks.length} {t('task(s)')}
        </span>
        {onClear && (
          <button
            className='text-muted-foreground hover:text-destructive text-xs'
            onClick={onClear}
            type='button'
          >
            {t('Clear all')}
          </button>
        )}
      </div>
      <div className='flex flex-col gap-4'>
        {tasks.map((task) => (
          <ImageTaskCard key={task.id} task={task} />
        ))}
      </div>
    </div>
  )
}

function ImageTaskCard({ task }: { task: ImageTask }) {
  const { t } = useTranslation()

  const handleCopyUrl = (src: string) => {
    navigator.clipboard.writeText(src)
    toast.success(t('Image URL copied'))
  }

  return (
    <div className='bg-card border-border overflow-hidden rounded-xl border shadow-sm'>
      <div className='border-border/60 flex items-center justify-between border-b px-4 py-2.5'>
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground text-xs font-medium'>
            {task.model}
          </span>
          <span className='text-muted-foreground/60 text-xs'>•</span>
          <span className='text-muted-foreground/80 text-xs'>{task.size}</span>
          <span className='text-muted-foreground/60 text-xs'>•</span>
          <span className='text-muted-foreground/80 text-xs'>
            {new Date(task.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <TaskStatusBadge status={task.status} />
      </div>

      <div className='px-4 py-2'>
        {task.prompt && (
          <p className='line-clamp-3 text-sm leading-relaxed break-words whitespace-pre-wrap'>
            {task.prompt}
          </p>
        )}
        {task.referenceImages.length > 0 && (
          <div className='mt-2 flex gap-1.5'>
            {task.referenceImages.map((item) => (
              <img
                key={item.id}
                src={item.src}
                alt={t('Reference image')}
                className='size-12 rounded border object-cover'
              />
            ))}
          </div>
        )}
      </div>

      {task.status === 'completed' && task.images.length > 0 && (
        <div className='border-border/60 border-t p-3'>
          <div className='grid grid-cols-2 gap-2 md:grid-cols-3'>
            {task.images.map((image) => (
              <div
                key={image.id}
                className='group relative overflow-hidden rounded-lg border'
              >
                {/* 点击放大查看原图，下载与复制链接走右下角的悬浮操作 */}
                <ZoomableImage
                  src={image.src}
                  alt={task.prompt || task.model}
                  className='aspect-square w-full'
                />
                <div className='absolute right-1.5 bottom-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
                  <button
                    className='bg-background/85 text-muted-foreground hover:text-foreground rounded px-1.5 py-1 text-[10px]'
                    onClick={() => handleCopyUrl(image.src)}
                    type='button'
                  >
                    {t('Copy URL')}
                  </button>
                  <a
                    className='bg-background/85 text-muted-foreground hover:text-foreground flex items-center gap-0.5 rounded px-1.5 py-1 text-[10px]'
                    download
                    href={image.src}
                  >
                    <DownloadIcon size={10} />
                    {t('Download')}
                  </a>
                </div>
              </div>
            ))}
          </div>
          <a
            className='text-primary hover:text-primary/80 mt-2 inline-flex items-center gap-1 text-xs'
            download
            href={task.images[0].src}
          >
            <DownloadIcon size={14} />
            {t('Download')}
          </a>
        </div>
      )}

      {task.status === 'completed' && task.imagesExpired && (
        <div className='border-border/60 border-t p-3'>
          <div className='bg-muted text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm'>
            <ImageIcon size={16} />
            <span>{t('Inline images are not kept after a page refresh')}</span>
          </div>
        </div>
      )}

      {task.status === 'failed' && (
        <div className='border-border/60 border-t p-3'>
          <div className='bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg px-3 py-2 text-sm'>
            <AlertCircleIcon className='mt-0.5 shrink-0' size={16} />
            <span className='break-words'>
              {task.error || t('Generation failed')}
            </span>
          </div>
        </div>
      )}

      {task.status === 'cancelled' && (
        <div className='border-border/60 border-t p-3'>
          <div className='bg-muted text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm'>
            <XCircleIcon size={16} />
            <span>{t('Cancelled')}</span>
          </div>
        </div>
      )}

      {task.status === 'pending' && (
        <div className='border-border/60 border-t p-3'>
          <div className='text-muted-foreground flex items-center gap-2 text-sm'>
            <LoaderIcon className='text-primary size-4 animate-spin' />
            <span>{t('Generating...')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskStatusBadge({ status }: { status: ImageTask['status'] }) {
  const { t } = useTranslation()

  switch (status) {
    case 'completed':
      return (
        <span className='text-xs font-medium text-green-600'>
          {t('Completed')}
        </span>
      )
    case 'failed':
      return (
        <span className='text-destructive text-xs font-medium'>
          {t('Failed')}
        </span>
      )
    case 'cancelled':
      return (
        <span className='text-muted-foreground text-xs font-medium'>
          {t('Cancelled')}
        </span>
      )
    default:
      return (
        <span className='text-primary text-xs font-medium'>
          {t('Generating')}
        </span>
      )
  }
}
