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

import {
  getDirectorSettings,
  getDirectorTokenOptions,
  updateDirectorSettings,
} from './api'

export function DirectorSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [tokenId, setTokenId] = React.useState('')
  const [textModel, setTextModel] = React.useState('')
  const [imageModel, setImageModel] = React.useState('')
  const [videoModel, setVideoModel] = React.useState('')

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
    }
    if (data.token) {
      setTokenId(String(data.token.tokenId))
    }
  }, [settingsQuery.data])

  const modelOptions = React.useMemo(
    () =>
      (modelsQuery.data?.data ?? []).map((model) => ({
        value: model,
        label: model,
      })),
    [modelsQuery.data]
  )

  // 仅展示启用中的令牌（后端拒绝绑定已禁用令牌）
  const tokenOptions = React.useMemo(
    () =>
      (tokensQuery.data?.data?.items ?? [])
        .filter((token) => token.status === 1)
        .map((token) => ({
          value: String(token.id),
          label: `${token.name} sk-${token.key}`,
        })),
    [tokensQuery.data]
  )

  const saveMutation = useMutation({
    mutationFn: () =>
      updateDirectorSettings({
        textModel: textModel.trim(),
        imageModel: imageModel.trim(),
        videoModel: videoModel.trim(),
        tokenId: Number(tokenId) || 0,
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Settings saved'))
        queryClient.invalidateQueries({ queryKey: ['director', 'settings'] })
      }
    },
    onError: handleServerError,
  })

  const isPending = settingsQuery.isPending || modelsQuery.isPending

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
                'Models are served by the gateway channels. Pick a model for each capability; usage is billed to your own account.'
              )}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>{t('Model Selection')}</CardTitle>
              <CardDescription>
                {t('Choose the models used by the production pipeline')}
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
                  <div className='grid gap-2'>
                    <Label htmlFor='director-internal-token'>
                      {t('Internal Token')}
                    </Label>
                    <ComboboxInput
                      id='director-internal-token'
                      options={tokenOptions}
                      value={tokenId}
                      onValueChange={setTokenId}
                      placeholder={t('Select a token for AI calls...')}
                      emptyText={t('No token found.')}
                    />
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'AI calls are billed through this token. Create tokens on the API Keys page.'
                      )}
                    </p>
                  </div>
                  <ModelField
                    id='director-text-model'
                    label={t('Text Model')}
                    description={t(
                      'Used for rewriting, extraction and storyboard splitting'
                    )}
                    options={modelOptions}
                    value={textModel}
                    onValueChange={setTextModel}
                  />
                  <ModelField
                    id='director-image-model'
                    label={t('Image Model')}
                    description={t(
                      'Used for character, scene, prop and storyboard images'
                    )}
                    options={modelOptions}
                    value={imageModel}
                    onValueChange={setImageModel}
                  />
                  <ModelField
                    id='director-video-model'
                    label={t('Video Model')}
                    description={t('Used for shot video generation')}
                    options={modelOptions}
                    value={videoModel}
                    onValueChange={setVideoModel}
                  />
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

interface ModelFieldProps {
  id: string
  label: string
  description: string
  options: { value: string; label: string }[]
  value: string
  onValueChange: (value: string) => void
}

function ModelField(props: ModelFieldProps) {
  const { t } = useTranslation()
  return (
    <div className='grid gap-2'>
      <Label htmlFor={props.id}>{props.label}</Label>
      <ComboboxInput
        id={props.id}
        options={props.options}
        value={props.value}
        onValueChange={props.onValueChange}
        placeholder={t('Select or type a model name...')}
        emptyText={t('No model found.')}
        allowCustomValue
      />
      <p className='text-muted-foreground text-xs'>{props.description}</p>
    </div>
  )
}
