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
import { Info } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ComboboxInput } from '@/components/ui/combobox-input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserModels } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { getModelCategory } from '@/lib/model-category'

import {
  getDirectorSettings,
  getDirectorTokenOptions,
  updateDirectorSettings,
  type DirectorTokenOption,
} from './api'

export function DirectorSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [textModel, setTextModel] = React.useState('')
  const [imageModel, setImageModel] = React.useState('')
  const [videoModel, setVideoModel] = React.useState('')
  const [audioModel, setAudioModel] = React.useState('')
  const [textTokenId, setTextTokenId] = React.useState('')
  const [imageTokenId, setImageTokenId] = React.useState('')
  const [videoTokenId, setVideoTokenId] = React.useState('')

  const settingsQuery = useQuery({
    queryKey: ['director', 'settings'],
    queryFn: getDirectorSettings,
  })

  const modelsQuery = useQuery({
    queryKey: ['director', 'user-models'],
    queryFn: getUserModels,
  })

  const tokensQuery = useQuery({
    queryKey: ['director', 'token-options'],
    queryFn: getDirectorTokenOptions,
  })

  React.useEffect(() => {
    const data = settingsQuery.data?.data
    if (!data) return
    const settings = data.settings
    if (settings) {
      setTextModel(settings.textModel ?? '')
      setImageModel(settings.imageModel ?? '')
      setVideoModel(settings.videoModel ?? '')
      setAudioModel(settings.audioModel ?? '')
    }
    setTextTokenId(data.tokens?.text ? String(data.tokens.text.tokenId) : '')
    setImageTokenId(data.tokens?.image ? String(data.tokens.image.tokenId) : '')
    setVideoTokenId(data.tokens?.video ? String(data.tokens.video.tokenId) : '')
  }, [settingsQuery.data])

  // 仅展示启用中的令牌（后端拒绝绑定已禁用令牌）
  const enabledTokens = React.useMemo(
    () =>
      (tokensQuery.data?.data?.items ?? []).filter(
        (token) => token.status === 1
      ),
    [tokensQuery.data]
  )

  // 下拉选项按能力分类过滤：语言/图片/视频模型各自只展示同类模型
  const modelsByCategory = React.useMemo(() => {
    const models = modelsQuery.data?.data ?? []
    return {
      text: models.filter((model) => getModelCategory(model) === 'text'),
      image: models.filter((model) => getModelCategory(model) === 'image'),
      video: models.filter((model) => getModelCategory(model) === 'video'),
    }
  }, [modelsQuery.data])

  // Key 按能力过滤：已分类 Key 只出现在对应能力下；存量空类型 Key 三项能力通用
  const textTokens = React.useMemo(
    () =>
      enabledTokens.filter(
        (token) => !token.key_type || token.key_type === 'language'
      ),
    [enabledTokens]
  )
  const imageTokens = React.useMemo(
    () =>
      enabledTokens.filter(
        (token) => !token.key_type || token.key_type === 'image'
      ),
    [enabledTokens]
  )
  const videoTokens = React.useMemo(
    () =>
      enabledTokens.filter(
        (token) => !token.key_type || token.key_type === 'video'
      ),
    [enabledTokens]
  )

  const textTokenOptions = React.useMemo(
    () =>
      textTokens.map((token) => ({
        value: String(token.id),
        label: `${token.name} sk-${token.key}`,
      })),
    [textTokens]
  )
  const imageTokenOptions = React.useMemo(
    () =>
      imageTokens.map((token) => ({
        value: String(token.id),
        label: `${token.name} sk-${token.key}`,
      })),
    [imageTokens]
  )
  // 视频 Key 锁定单一视频模型，选项标注绑定模型便于核对
  const videoTokenOptions = React.useMemo(
    () =>
      videoTokens.map((token) => ({
        value: String(token.id),
        label: token.video_model
          ? `${token.name} (${token.video_model}) sk-${token.key}`
          : `${token.name} sk-${token.key}`,
      })),
    [videoTokens]
  )

  // 先选 Key 再选模型：模型候选随所选 Key 收窄（视频 Key 锁定单一模型，限制模型的 Key 只列其允许模型）；
  // 只在本能力候选内解析 Key，避免跨能力误命中导致模型列表被错误收窄
  const textModelOptions = React.useMemo(
    () =>
      getKeyModelOptions(
        modelsByCategory.text,
        textTokens.find((token) => String(token.id) === textTokenId)
      ),
    [modelsByCategory, textTokens, textTokenId]
  )
  const imageModelOptions = React.useMemo(
    () =>
      getKeyModelOptions(
        modelsByCategory.image,
        imageTokens.find((token) => String(token.id) === imageTokenId)
      ),
    [modelsByCategory, imageTokens, imageTokenId]
  )
  const videoModelOptions = React.useMemo(
    () =>
      getKeyModelOptions(
        modelsByCategory.video,
        videoTokens.find((token) => String(token.id) === videoTokenId)
      ),
    [modelsByCategory, videoTokens, videoTokenId]
  )
  // 音频（TTS）模型复用语言 Key：候选随所选语言 Key 收窄
  const audioModelOptions = React.useMemo(
    () =>
      getKeyModelOptions(
        (modelsQuery.data?.data ?? []).filter((model) =>
          /tts|audio|speech/i.test(model)
        ),
        textTokens.find((token) => String(token.id) === textTokenId)
      ),
    [modelsQuery.data, textTokens, textTokenId]
  )

  // 存量设定可能绑定已删除/禁用/类型不符的 Key：不在本能力候选内即视为未选择，
  // 避免回显裸 ID、错误收窄模型列表，以及保存时把失效绑定原样写回
  React.useEffect(() => {
    if (!tokensQuery.data) return
    if (textTokenId && !textTokenOptions.some((o) => o.value === textTokenId)) {
      setTextTokenId('')
    }
    if (
      imageTokenId &&
      !imageTokenOptions.some((o) => o.value === imageTokenId)
    ) {
      setImageTokenId('')
    }
    if (
      videoTokenId &&
      !videoTokenOptions.some((o) => o.value === videoTokenId)
    ) {
      setVideoTokenId('')
    }
  }, [
    tokensQuery.data,
    textTokenOptions,
    imageTokenOptions,
    videoTokenOptions,
    textTokenId,
    imageTokenId,
    videoTokenId,
  ])

  // 切换 Key 后，若当前模型不在新 Key 的允许列表内，自动落到首个候选；未限制模型的 Key 不改写已选模型
  const handleTextTokenChange = (value: string) => {
    setTextTokenId(value)
    const token = textTokens.find((item) => String(item.id) === value)
    if (!token?.model_limits_enabled) return
    const options = getKeyModelOptions(modelsByCategory.text, token)
    if (options.length > 0 && !options.some((o) => o.value === textModel)) {
      setTextModel(options[0].value)
    }
  }
  const handleImageTokenChange = (value: string) => {
    setImageTokenId(value)
    const token = imageTokens.find((item) => String(item.id) === value)
    if (!token?.model_limits_enabled) return
    const options = getKeyModelOptions(modelsByCategory.image, token)
    if (options.length > 0 && !options.some((o) => o.value === imageModel)) {
      setImageModel(options[0].value)
    }
  }

  // 视频 Key 与模型强绑定：选中 Key 后自动填入其绑定模型，避免模型/Key 不一致
  const handleVideoTokenChange = (value: string) => {
    setVideoTokenId(value)
    const token = videoTokens.find((item) => String(item.id) === value)
    if (token?.video_model) {
      setVideoModel(token.video_model)
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateDirectorSettings({
        textModel: textModel.trim(),
        imageModel: imageModel.trim(),
        videoModel: videoModel.trim(),
        audioModel: audioModel.trim(),
        textTokenId: Number(textTokenId) || 0,
        imageTokenId: Number(imageTokenId) || 0,
        videoTokenId: Number(videoTokenId) || 0,
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Settings saved'))
        queryClient.invalidateQueries({ queryKey: ['director', 'settings'] })
      }
    },
    onError: handleServerError,
  })

  const isPending =
    settingsQuery.isPending || modelsQuery.isPending || tokensQuery.isPending

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Director Model Settings')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto max-w-2xl space-y-6'>
          <Alert>
            <Info aria-hidden='true' className='size-4' />
            <AlertDescription>
              {t(
                'Models are served by the gateway channels. Pick a model and key for each capability; usage is billed to your own account.'
              )}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>{t('Model Selection')}</CardTitle>
              <CardDescription>
                {t(
                  'Choose the models and keys used by the production pipeline'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-5'>
              {isPending ? (
                <div className='space-y-4'>
                  <Skeleton className='h-9 w-full' />
                  <Skeleton className='h-9 w-full' />
                  <Skeleton className='h-9 w-full' />
                  <Skeleton className='h-9 w-full' />
                </div>
              ) : (
                <>
                  <div className='space-y-4'>
                    <div className='space-y-1'>
                      <h3 className='text-sm font-semibold'>
                        {t('Text Model')}
                      </h3>
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Used for rewriting, extraction and storyboard splitting'
                        )}
                      </p>
                    </div>
                    <ComboboxField
                      id='director-text-token'
                      label={t('Language Model Key')}
                      options={textTokenOptions}
                      value={
                        textTokenOptions.some((o) => o.value === textTokenId)
                          ? textTokenId
                          : ''
                      }
                      onValueChange={handleTextTokenChange}
                      placeholder={t('Not selected')}
                      emptyText={t('No available key.')}
                    />
                    <ComboboxField
                      id='director-text-model'
                      label={t('Model')}
                      description={t(
                        'Select a key first, then choose a model allowed by that key.'
                      )}
                      options={textModelOptions}
                      value={textModel}
                      onValueChange={setTextModel}
                      placeholder={t('Not selected')}
                      emptyText={t('No model found.')}
                      allowCustomValue
                    />
                  </div>
                  <div className='space-y-4 border-t pt-5'>
                    <div className='space-y-1'>
                      <h3 className='text-sm font-semibold'>
                        {t('Image Model')}
                      </h3>
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Used for character, scene, prop and storyboard images'
                        )}
                      </p>
                    </div>
                    <ComboboxField
                      id='director-image-token'
                      label={t('Image Model Key')}
                      options={imageTokenOptions}
                      value={
                        imageTokenOptions.some((o) => o.value === imageTokenId)
                          ? imageTokenId
                          : ''
                      }
                      onValueChange={handleImageTokenChange}
                      placeholder={t('Not selected')}
                      emptyText={t('No available key.')}
                    />
                    <ComboboxField
                      id='director-image-model'
                      label={t('Model')}
                      description={t(
                        'Select a key first, then choose a model allowed by that key.'
                      )}
                      options={imageModelOptions}
                      value={imageModel}
                      onValueChange={setImageModel}
                      placeholder={t('Not selected')}
                      emptyText={t('No model found.')}
                      allowCustomValue
                    />
                  </div>
                  <div className='space-y-4 border-t pt-5'>
                    <div className='space-y-1'>
                      <h3 className='text-sm font-semibold'>
                        {t('Video Model')}
                      </h3>
                      <p className='text-muted-foreground text-xs'>
                        {t('Used for shot video generation')}
                      </p>
                    </div>
                    <ComboboxField
                      id='director-video-token'
                      label={t('Video Model Key')}
                      description={t(
                        'A video key is bound to a single video model. Selecting a key fills in its model automatically.'
                      )}
                      options={videoTokenOptions}
                      value={
                        videoTokenOptions.some((o) => o.value === videoTokenId)
                          ? videoTokenId
                          : ''
                      }
                      onValueChange={handleVideoTokenChange}
                      placeholder={t('Not selected')}
                      emptyText={t('No available key.')}
                    />
                    <ComboboxField
                      id='director-video-model'
                      label={t('Model')}
                      options={videoModelOptions}
                      value={videoModel}
                      onValueChange={setVideoModel}
                      placeholder={t('Not selected')}
                      emptyText={t('No model found.')}
                      allowCustomValue
                    />
                  </div>
                  <div className='space-y-4 border-t pt-5'>
                    <div className='space-y-1'>
                      <h3 className='text-sm font-semibold'>
                        {t('Audio Model')}
                      </h3>
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Used for speech generation on the canvas; it reuses the language model key'
                        )}
                      </p>
                    </div>
                    <ComboboxField
                      id='director-audio-model'
                      label={t('Model')}
                      options={audioModelOptions}
                      value={audioModel}
                      onValueChange={setAudioModel}
                      placeholder={t('Not selected')}
                      emptyText={t('No model found.')}
                      allowCustomValue
                    />
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'AI calls are billed through the key selected for each capability. Create language, image and video model keys on the API Keys page.'
                    )}
                  </p>
                </>
              )}
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || isPending}
              >
                {saveMutation.isPending ? t('Saving...') : t('Save')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

// Key 约束下的模型候选：视频 Key 锁定其绑定的单一模型；启用模型限制的 Key
// 与能力列表取交集（交集为空时展示 Key 允许列表）；未限制的 Key 展示该能力全部模型
function getKeyModelOptions(
  baseModels: string[],
  token: DirectorTokenOption | undefined
): { value: string; label: string }[] {
  if (token?.video_model) {
    return [{ value: token.video_model, label: token.video_model }]
  }
  let candidates = baseModels
  if (token?.model_limits_enabled && token.model_limits) {
    const limits = token.model_limits
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean)
    if (limits.length > 0) {
      const intersection = baseModels.filter((model) => limits.includes(model))
      candidates = intersection.length > 0 ? intersection : limits
    }
  }
  return candidates.map((model) => ({ value: model, label: model }))
}

interface ComboboxFieldProps {
  id: string
  label: string
  description?: string
  options: { value: string; label: string }[]
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  emptyText: string
  allowCustomValue?: boolean
}

function ComboboxField(props: ComboboxFieldProps) {
  return (
    <div className='grid gap-2'>
      <Label htmlFor={props.id}>{props.label}</Label>
      <ComboboxInput
        id={props.id}
        options={props.options}
        value={props.value}
        onValueChange={props.onValueChange}
        placeholder={props.placeholder}
        emptyText={props.emptyText}
        allowCustomValue={props.allowCustomValue}
      />
      {props.description && (
        <p className='text-muted-foreground text-xs'>{props.description}</p>
      )}
    </div>
  )
}
