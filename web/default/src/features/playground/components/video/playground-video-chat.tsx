import {
  AlertCircleIcon,
  CheckCircleIcon,
  DownloadIcon,
  FilmIcon,
  LoaderIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

import type { VideoTask } from '../../types'

interface PlaygroundVideoChatProps {
  tasks: VideoTask[]
  onClear?: () => void
}

export function PlaygroundVideoChat({ tasks, onClear }: PlaygroundVideoChatProps) {
  const { t } = useTranslation()

  if (tasks.length === 0) {
    return (
      <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-4'>
        <div className='bg-muted/50 flex size-16 items-center justify-center rounded-full'>
          <FilmIcon className='text-muted-foreground' size={28} />
        </div>
        <p className='text-muted-foreground text-sm'>
          {t('Generate videos by entering a prompt below')}
        </p>
      </div>
    )
  }

  return (
    <div className='mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-4 py-6'>
      <div className='mb-3 flex items-center justify-between'>
        <span className='text-muted-foreground text-sm'>
          {tasks.length} {t('task(s)')}
        </span>
        {onClear && (
          <button
            className='text-muted-foreground hover:text-destructive text-xs'
            onClick={onClear}
          >
            {t('Clear all')}
          </button>
        )}
      </div>
      <div className='flex flex-col gap-4'>
        {tasks.map((task) => (
          <VideoTaskCard key={task.taskId} task={task} />
        ))}
      </div>
    </div>
  )
}

function VideoTaskCard({ task }: { task: VideoTask }) {
  const { t } = useTranslation()

  const handleCopyUrl = () => {
    if (task.videoUrl) {
      navigator.clipboard.writeText(task.videoUrl)
      toast.success(t('Video URL copied'))
    }
  }

  return (
    <div className='bg-card border-border overflow-hidden rounded-xl border shadow-sm'>
      {/* Task header */}
      <div className='border-border/60 flex items-center justify-between border-b px-4 py-2.5'>
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground text-xs font-medium'>
            {task.model}
          </span>
          <span className='text-muted-foreground/60 text-xs'>•</span>
          <span className='text-muted-foreground/80 text-xs'>
            {new Date(task.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <TaskStatusBadge status={task.status} progress={task.progress} />
      </div>

      {/* Prompt */}
      <div className='px-4 py-2'>
        <p className='text-sm leading-relaxed line-clamp-2'>{task.prompt}</p>
        {task.images.length > 0 && (
          <div className='mt-2 flex gap-1.5'>
            {task.images.map((img, i) => (
              <img
                key={i}
                src={img}
                alt={`ref-${i}`}
                className='size-12 rounded border object-cover'
              />
            ))}
          </div>
        )}
      </div>

      {/* Result */}
      {task.status === 'completed' && task.videoUrl && (
        <div className='border-border/60 border-t p-3'>
          <div className='overflow-hidden rounded-lg bg-black'>
            <video
              controls
              className='aspect-video w-full'
              src={task.videoUrl}
            />
          </div>
          <div className='mt-2 flex items-center gap-2'>
            <a
              className='text-primary hover:text-primary/80 flex items-center gap-1 text-xs'
              download
              href={task.videoUrl}
            >
              <DownloadIcon size={14} />
              {t('Download')}
            </a>
            <button
              className='text-muted-foreground hover:text-foreground text-xs'
              onClick={handleCopyUrl}
            >
              {t('Copy URL')}
            </button>
          </div>
        </div>
      )}

      {task.status === 'failed' && (
        <div className='border-border/60 border-t p-3'>
          <div className='bg-destructive/5 text-destructive flex items-center gap-2 rounded-lg px-3 py-2 text-sm'>
            <AlertCircleIcon size={16} />
            <span>{task.error || t('Generation failed')}</span>
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

      {(task.status === 'queued' || task.status === 'in_progress') && (
        <div className='border-border/60 border-t p-3'>
          <div className='flex items-center gap-3'>
            <LoaderIcon className='text-primary size-4 animate-spin' />
            <div className='flex-1'>
              <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
                <div
                  className='bg-primary h-full rounded-full transition-all duration-500'
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            </div>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {task.status === 'queued'
                ? t('Queued...')
                : `${task.progress}%`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskStatusBadge({
  status,
  progress,
}: {
  status: VideoTask['status']
  progress: number
}) {
  const { t } = useTranslation()

  switch (status) {
    case 'completed':
      return (
        <span className='flex items-center gap-1 text-xs font-medium text-green-600'>
          <CheckCircleIcon size={14} />
          {t('Completed')}
        </span>
      )
    case 'failed':
      return (
        <span className='flex items-center gap-1 text-xs font-medium text-destructive'>
          <AlertCircleIcon size={14} />
          {t('Failed')}
        </span>
      )
    case 'cancelled':
      return (
        <span className='text-muted-foreground flex items-center gap-1 text-xs font-medium'>
          <XCircleIcon size={14} />
          {t('Cancelled')}
        </span>
      )
    case 'queued':
      return (
        <span className='text-muted-foreground text-xs font-medium'>
          {t('Queued')}
        </span>
      )
    default:
      return (
        <span className='text-primary text-xs font-medium'>
          {progress}%
        </span>
      )
  }
}
