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
import { zodResolver } from '@hookform/resolvers/zod'
import { useRef, useState } from 'react'
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { uploadDirectorFile } from '@/features/director/api'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsFormGridItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

const _systemInfoSchema = z.object({
  theme: z.object({
    frontend: z.enum(['default', 'classic']),
  }),
  SystemName: z.string().min(1),
  ServerAddress: z.string().optional(),
  Logo: z.string().url().optional().or(z.literal('')),
  SupportQRCode: z.string().url().optional().or(z.literal('')),
  SupportContact: z.string().optional(),
  Footer: z.string().optional(),
  About: z.string().optional(),
  HomePageContent: z.string().optional(),
  legal: z.object({
    user_agreement: z.string().optional(),
    privacy_policy: z.string().optional(),
  }),
})

type SystemInfoFormValues = z.infer<typeof _systemInfoSchema>

type SystemInfoSectionProps = {
  defaultValues: SystemInfoFormValues
}

function normalizeValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

export function SystemInfoSection({ defaultValues }: SystemInfoSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const normalizedDefaults: SystemInfoFormValues = {
    theme: {
      frontend:
        defaultValues.theme?.frontend === 'classic' ? 'classic' : 'default',
    },
    SystemName: normalizeValue(defaultValues.SystemName),
    ServerAddress: normalizeValue(defaultValues.ServerAddress),
    Logo: normalizeValue(defaultValues.Logo),
    SupportQRCode: normalizeValue(defaultValues.SupportQRCode),
    SupportContact: normalizeValue(defaultValues.SupportContact),
    Footer: normalizeValue(defaultValues.Footer),
    About: normalizeValue(defaultValues.About),
    HomePageContent: normalizeValue(defaultValues.HomePageContent),
    legal: {
      user_agreement: normalizeValue(defaultValues.legal?.user_agreement),
      privacy_policy: normalizeValue(defaultValues.legal?.privacy_policy),
    },
  }

  const systemInfoSchemaWithI18n = z.object({
    theme: z.object({
      frontend: z.enum(['default', 'classic']),
    }),
    SystemName: z.string().min(1, {
      error: () => t('System name is required'),
    }),
    ServerAddress: z.string().optional(),
    Logo: z.string().url().optional().or(z.literal('')),
    SupportQRCode: z.string().url().optional().or(z.literal('')),
    SupportContact: z.string().optional(),
    Footer: z.string().optional(),
    About: z.string().optional(),
    HomePageContent: z.string().optional(),
    legal: z.object({
      user_agreement: z.string().optional(),
      privacy_policy: z.string().optional(),
    }),
  })

  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm<SystemInfoFormValues>({
      resolver: zodResolver(systemInfoSchemaWithI18n) as Resolver<
        SystemInfoFormValues,
        unknown,
        SystemInfoFormValues
      >,
      defaultValues: normalizedDefaults,
      onSubmit: async (_data, changedFields) => {
        // 主题切换会改变后端返回的前端产物，需放到最后处理：先更新其余设置项，
        // 仅当它们全部成功后才提交主题切换，避免其它设置失败时就切换了主题，
        // 导致用户停留或刷新到另一套前端不存在的路由而 404。
        const entries = Object.entries(changedFields)
        const themeEntry = entries.find(([key]) => key === 'theme.frontend')
        const otherEntries = entries.filter(([key]) => key !== 'theme.frontend')

        let allSucceeded = true
        for (const [key, value] of otherEntries) {
          let v = normalizeValue(value)
          if (key === 'ServerAddress') {
            v = v.replace(/\/+$/, '')
          }
          const res = await updateOption.mutateAsync({
            key,
            value: v,
          })
          if (!res.success) {
            allSucceeded = false
          }
        }
        if (themeEntry && !allSucceeded) {
          // Theme was not submitted; keep form state consistent with backend.
          _data.theme.frontend = normalizedDefaults.theme.frontend
          return
        }
        if (themeEntry && allSucceeded) {
          const res = await updateOption.mutateAsync({
            key: themeEntry[0],
            value: normalizeValue(themeEntry[1]),
          })
          if (res.success) {
            // 当前路由在另一套前端中并不存在，主题切换成功后重置到首页以避免 404。
            // 延时用于让表单脏状态先清除（移除 beforeunload 拦截）并展示成功提示后再刷新；
            // 使用 replace 让已失效的路由不进入历史，防止返回按钮再次触发 404。
            setTimeout(() => {
              window.location.replace('/')
            }, 600)
          } else {
            // Theme update failed; revert to the last saved value.
            _data.theme.frontend = normalizedDefaults.theme.frontend
          }
        }
      },
    })

  const qrInputRef = useRef<HTMLInputElement>(null)
  const [qrUploading, setQrUploading] = useState(false)

  // 二维码上传复用云导演的纯文件上传：存 TOS 返回 URL，不登记素材库。
  async function handleQrFileChange(file: File | undefined) {
    if (!file) return
    setQrUploading(true)
    try {
      const res = await uploadDirectorFile({ file })
      if (res.success && res.data?.url) {
        form.setValue('SupportQRCode', res.data.url, { shouldDirty: true })
      } else {
        toast.error(res.message || t('Failed to upload image'))
      }
    } catch {
      toast.error(t('Failed to upload image'))
    } finally {
      setQrUploading(false)
      if (qrInputRef.current) qrInputRef.current.value = ''
    }
  }

  return (
    <>
      <FormNavigationGuard when={isDirty} />

      <SettingsSection title={t('System Information')}>
        <Form {...form}>
          <SettingsForm onSubmit={handleSubmit}>
            <SettingsPageFormActions
              onSave={handleSubmit}
              onReset={handleReset}
              isSaving={isSubmitting || updateOption.isPending}
              isResetDisabled={!isDirty}
            />
            <FormDirtyIndicator isDirty={isDirty} />
            <SettingsFormGrid>
              <FormField
                control={form.control}
                name='theme.frontend'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Frontend Theme')}</FormLabel>
                    <Select
                      items={[
                        {
                          value: 'default',
                          label: t('Default (New Frontend)'),
                        },
                        {
                          value: 'classic',
                          label: t('Classic (Legacy Frontend)'),
                        },
                      ]}
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className='w-full'>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          <SelectItem value='default'>
                            {t('Default (New Frontend)')}
                          </SelectItem>
                          <SelectItem value='classic'>
                            {t('Classic (Legacy Frontend)')}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {t(
                        'Switch between the new frontend and the classic frontend. Changes take effect after page reload.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='SystemName'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('System Name')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('New API')} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('The name displayed across the application')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='ServerAddress'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Server Address')}</FormLabel>
                    <FormControl>
                      <Input placeholder='https://yourdomain.com' {...field} />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'The public URL of your server, used for OAuth callbacks, webhooks, and other external integrations'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='Logo'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Logo URL')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('https://example.com/logo.png')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('URL to your logo image (optional)')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='SupportQRCode'
                render={({ field }) => {
                  let qrButtonLabel = t('Upload')
                  if (qrUploading) {
                    qrButtonLabel = t('Uploading...')
                  } else if (field.value) {
                    qrButtonLabel = t('Replace')
                  }
                  return (
                    <FormItem>
                      <FormLabel>{t('Support QR Code')}</FormLabel>
                      <FormControl>
                        <div className='flex items-start gap-3'>
                          {field.value ? (
                            <img
                              src={field.value}
                              alt={t('Support QR Code')}
                              className='border-border bg-card size-20 shrink-0 rounded-lg border object-contain'
                            />
                          ) : null}
                          <div className='flex min-w-0 flex-1 flex-col gap-2'>
                            <div className='flex gap-2'>
                              <Button
                                type='button'
                                size='sm'
                                variant='outline'
                                disabled={qrUploading}
                                onClick={() => qrInputRef.current?.click()}
                              >
                                {qrButtonLabel}
                              </Button>
                              {field.value ? (
                                <Button
                                  type='button'
                                  size='sm'
                                  variant='ghost'
                                  onClick={() => field.onChange('')}
                                >
                                  {t('Remove')}
                                </Button>
                              ) : null}
                            </div>
                            <Input
                              placeholder={t('https://example.com/qrcode.png')}
                              {...field}
                            />
                          </div>
                          <input
                            ref={qrInputRef}
                            type='file'
                            accept='image/*'
                            className='hidden'
                            onChange={(event) =>
                              void handleQrFileChange(event.target.files?.[0])
                            }
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Upload a QR code image displayed on the Contact Support page.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />

              <FormField
                control={form.control}
                name='SupportContact'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Support Contact')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('support@example.com')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Email or other contact information displayed on the Contact Support page.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='Footer'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Footer')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          '© 2025 Your Company. All rights reserved.'
                        )}
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Footer text displayed at the bottom of pages')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='About'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('About')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          'Enter HTML code (e.g., <p>About us...</p>) or a URL (e.g., https://example.com) to embed as iframe'
                        )}
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Supports HTML markup or iframe embedding. Enter HTML code directly, or provide a complete URL to automatically embed it as an iframe.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <SettingsFormGridItem span='full'>
                <FormField
                  control={form.control}
                  name='HomePageContent'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Home Page Content')}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t('Welcome to our New API...')}
                          rows={6}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Content displayed on the home page (supports Markdown)'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsFormGridItem>

              <FormField
                control={form.control}
                name='legal.user_agreement'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('User Agreement')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          'Provide Markdown, HTML, or an external URL for the user agreement'
                        )}
                        rows={6}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Leave empty to disable the agreement requirement. Supports Markdown, HTML, or a full URL to redirect users.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='legal.privacy_policy'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Privacy Policy')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t(
                          'Provide Markdown, HTML, or an external URL for the privacy policy'
                        )}
                        rows={6}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Leave empty to disable the privacy policy requirement. Supports Markdown, HTML, or a full URL to redirect users.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SettingsFormGrid>
          </SettingsForm>
        </Form>
      </SettingsSection>
    </>
  )
}
