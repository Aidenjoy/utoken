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
import { useMutation } from '@tanstack/react-query'
import {
  Clapperboard,
  Image as ImageIcon,
  Pencil,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { handleServerError } from '@/lib/handle-server-error'

import {
  generateStoryboardImage,
  generateStoryboardPrompt,
  generateStoryboardVideo,
  generateStoryboardVideoPrompt,
} from '../api'
import { GEN_STATUS_BADGE_VARIANT, GEN_STATUS_LABEL } from '../constants'
import {
  generationFinished,
  useImageGenerationPoll,
  useVideoGenerationPoll,
} from '../hooks/use-generation-polling'
import type { DirectorEpisode, DirectorStoryboard } from '../types'

interface StoryboardCardProps {
  storyboard: DirectorStoryboard
  episode: DirectorEpisode
  onEdit: () => void
  onDelete: () => void
  onChanged: () => void
}

export function StoryboardCard(props: StoryboardCardProps) {
  const { t } = useTranslation()
  const { storyboard } = props

  const [imageGenId, setImageGenId] = React.useState<number | null>(null)
  const [videoGenId, setVideoGenId] = React.useState<number | null>(null)
  const imageGenQuery = useImageGenerationPoll(imageGenId)
  const videoGenQuery = useVideoGenerationPoll(videoGenId)
  const imageGen = imageGenQuery.data?.data ?? null
  const videoGen = videoGenQuery.data?.data ?? null

  React.useEffect(() => {
    if (imageGen && generationFinished(imageGen)) {
      if (imageGen.status === 'failed') {
        toast.error(imageGen.errorMsg || t('Image generation failed'))
      }
      props.onChanged()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageGen?.status])

  React.useEffect(() => {
    if (videoGen && generationFinished(videoGen)) {
      if (videoGen.status === 'failed') {
        toast.error(videoGen.errorMsg || t('Video generation failed'))
      }
      props.onChanged()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoGen?.status])

  const imagePromptMutation = useMutation({
    mutationFn: () => generateStoryboardPrompt(storyboard.id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Prompt generated'))
        props.onChanged()
      }
    },
    onError: handleServerError,
  })

  const videoPromptMutation = useMutation({
    mutationFn: () => generateStoryboardVideoPrompt(storyboard.id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Video prompt generated'))
        props.onChanged()
      }
    },
    onError: handleServerError,
  })

  const imageMutation = useMutation({
    mutationFn: () => generateStoryboardImage({ id: storyboard.id }),
    onSuccess: (res) => {
      if (res.success && res.data) {
        setImageGenId(res.data.generationId)
        toast.success(t('Image generation started'))
      }
    },
    onError: handleServerError,
  })

  const videoMutation = useMutation({
    mutationFn: () =>
      generateStoryboardVideo({
        id: storyboard.id,
        aspectRatio: props.episode.aspectRatio || undefined,
        resolution: props.episode.resolution || undefined,
        frameMode: 'first_frame',
      }),
    onSuccess: (res) => {
      if (res.success && res.data) {
        setVideoGenId(res.data.generationId)
        toast.success(t('Video generation started'))
      }
    },
    onError: handleServerError,
  })

  const imageRunning =
    imageMutation.isPending ||
    (imageGen != null && !generationFinished(imageGen))
  const videoRunning =
    videoMutation.isPending ||
    (videoGen != null && !generationFinished(videoGen))

  // 预览区：成片视频 > 首帧图 > 占位符
  const renderPreview = () => {
    if (storyboard.videoUrl) {
      return (
        <video
          src={storyboard.videoUrl}
          controls
          preload='metadata'
          className='size-full object-contain'
        />
      )
    }
    if (storyboard.firstFrameImage) {
      return (
        <img
          src={storyboard.firstFrameImage}
          alt={storyboard.title || `#${storyboard.storyboardNumber}`}
          loading='lazy'
          className='size-full object-cover'
        />
      )
    }
    return (
      <div className='text-muted-foreground flex size-full items-center justify-center'>
        <Clapperboard aria-hidden='true' className='size-8' />
      </div>
    )
  }

  return (
    <Card className='overflow-hidden'>
      <div className='grid gap-0 md:grid-cols-2'>
        <div className='bg-muted relative aspect-video'>
          {renderPreview()}
          {imageGen && !generationFinished(imageGen) && (
            <Badge
              variant={GEN_STATUS_BADGE_VARIANT[imageGen.status]}
              className='absolute top-2 left-2'
            >
              {t(GEN_STATUS_LABEL[imageGen.status] ?? imageGen.status)}
            </Badge>
          )}
          {videoGen && !generationFinished(videoGen) && (
            <Badge
              variant={GEN_STATUS_BADGE_VARIANT[videoGen.status]}
              className='absolute top-2 right-2'
            >
              {t(GEN_STATUS_LABEL[videoGen.status] ?? videoGen.status)}
            </Badge>
          )}
        </div>
        <CardContent className='space-y-2 py-3'>
          <div className='flex items-center justify-between gap-2'>
            <span className='flex items-center gap-2 font-medium'>
              <Badge variant='outline'>{storyboard.storyboardNumber}</Badge>
              <span className='truncate'>
                {storyboard.title || t('Untitled shot')}
              </span>
            </span>
            <span className='flex shrink-0 gap-1'>
              <Button
                variant='ghost'
                size='icon'
                className='size-6'
                aria-label={t('Edit')}
                onClick={props.onEdit}
              >
                <Pencil aria-hidden='true' className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                className='text-destructive hover:text-destructive size-6'
                aria-label={t('Delete')}
                onClick={props.onDelete}
              >
                <Trash2 aria-hidden='true' className='size-3.5' />
              </Button>
            </span>
          </div>
          <p className='text-muted-foreground line-clamp-2 text-xs'>
            {[storyboard.shotType, storyboard.angle, storyboard.movement]
              .filter(Boolean)
              .join(' · ') || storyboard.result}
          </p>
          <div className='grid grid-cols-2 gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={imagePromptMutation.isPending}
              onClick={() => imagePromptMutation.mutate()}
            >
              <Sparkles aria-hidden='true' className='size-3.5' />
              {imagePromptMutation.isPending
                ? t('Generating...')
                : t('Image Prompt')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={videoPromptMutation.isPending}
              onClick={() => videoPromptMutation.mutate()}
            >
              <Sparkles aria-hidden='true' className='size-3.5' />
              {videoPromptMutation.isPending
                ? t('Generating...')
                : t('Video Prompt')}
            </Button>
            <Button
              size='sm'
              disabled={imageRunning}
              onClick={() => imageMutation.mutate()}
            >
              <ImageIcon aria-hidden='true' className='size-3.5' />
              {imageRunning ? t('Generating...') : t('First Frame')}
            </Button>
            <Button
              size='sm'
              disabled={videoRunning || !storyboard.firstFrameImage}
              onClick={() => videoMutation.mutate()}
            >
              <Video aria-hidden='true' className='size-3.5' />
              {videoRunning ? t('Generating...') : t('Video')}
            </Button>
          </div>
        </CardContent>
      </div>
    </Card>
  )
}
