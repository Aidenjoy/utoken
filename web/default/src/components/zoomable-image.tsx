import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// 点击放大查看的图片：缩略图保持传入的 className 布局，点击后弹层展示原图
export function ZoomableImage(props: {
  src: string
  alt?: string
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className={cn('block cursor-zoom-in', props.className)}
        aria-label={t('View image')}
      >
        <img
          src={props.src}
          alt={props.alt ?? ''}
          loading='lazy'
          className='size-full object-cover'
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className='bg-zinc-950/80 p-2 text-white ring-0 sm:max-w-fit'
        >
          <DialogTitle className='sr-only'>{t('View image')}</DialogTitle>
          <img
            src={props.src}
            alt={props.alt ?? ''}
            className='max-h-[85vh] max-w-[calc(90vw-1rem)] rounded-md object-contain'
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
