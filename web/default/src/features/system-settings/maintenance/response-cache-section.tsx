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
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

/**
 * Mirrors setting/operation_setting/response_cache_setting.go. The bounds here
 * are the same clamps the backend applies (ClampResponseCacheTTL and
 * GetResponseCacheMaxBodyBytes), so a rejected form value cannot silently
 * become a different effective value on the server.
 */
const TTL_MAX_SECONDS = 86400
const MAX_BODY_UPPER_BOUND = 8 * 1024 * 1024

/**
 * react-hook-form 7 treats dotted `name` strings as nested paths, so the form
 * state is modelled as a nested object and flattened back to the option keys
 * (`response_cache_setting.*`) only when persisting.
 */
const responseCacheSchema = z.object({
  response_cache_setting: z.object({
    enabled: z.boolean(),
    ttl_seconds: z.coerce.number().int().min(1).max(TTL_MAX_SECONDS),
    max_body_bytes: z.coerce.number().int().min(1024).max(MAX_BODY_UPPER_BOUND),
  }),
})

type ResponseCacheFormInput = z.input<typeof responseCacheSchema>
type ResponseCacheFormValues = z.output<typeof responseCacheSchema>

export type FlatResponseCacheDefaults = {
  'response_cache_setting.enabled': boolean
  'response_cache_setting.ttl_seconds': number
  'response_cache_setting.max_body_bytes': number
}

const buildFormDefaults = (
  defaults: FlatResponseCacheDefaults
): ResponseCacheFormInput => ({
  response_cache_setting: {
    enabled: defaults['response_cache_setting.enabled'],
    ttl_seconds: defaults['response_cache_setting.ttl_seconds'],
    max_body_bytes: defaults['response_cache_setting.max_body_bytes'],
  },
})

const normalizeFormValues = (
  values: ResponseCacheFormValues
): FlatResponseCacheDefaults => ({
  'response_cache_setting.enabled': values.response_cache_setting.enabled,
  'response_cache_setting.ttl_seconds':
    values.response_cache_setting.ttl_seconds,
  'response_cache_setting.max_body_bytes':
    values.response_cache_setting.max_body_bytes,
})

interface Props {
  defaultValues: FlatResponseCacheDefaults
}

export function ResponseCacheSection({ defaultValues }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<FlatResponseCacheDefaults>(defaultValues)
  const baselineSerializedRef = useRef<string>(JSON.stringify(defaultValues))

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<
    ResponseCacheFormInput,
    unknown,
    ResponseCacheFormValues
  >({
    resolver: zodResolver(responseCacheSchema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  useEffect(() => {
    const serialized = JSON.stringify(defaultValues)
    if (serialized === baselineSerializedRef.current) return
    baselineRef.current = defaultValues
    baselineSerializedRef.current = serialized
  }, [defaultValues])

  const enabled = form.watch('response_cache_setting.enabled')

  const onSubmit = async (values: ResponseCacheFormValues) => {
    const normalized = normalizeFormValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof FlatResponseCacheDefaults>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({
        key,
        value: normalized[key],
      })
    }

    baselineRef.current = normalized
    baselineSerializedRef.current = JSON.stringify(normalized)
  }

  return (
    <SettingsSection title={t('Response Cache')}>
      <Alert>
        <AlertDescription>
          {t(
            'Caching replays the previous upstream response for an identical text-only request and charges no quota. It requires Redis; when Redis is not configured the feature stays off automatically. Organizations can additionally override the switch and TTL on their own settings page.'
          )}
        </AlertDescription>
      </Alert>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          <FormField
            control={form.control}
            name='response_cache_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable response cache')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Global master switch. When off, no request is cached regardless of the organization setting.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='response_cache_setting.ttl_seconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Cache TTL (seconds)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      max={TTL_MAX_SECONDS}
                      step={1}
                      {...safeNumberFieldProps(field)}
                      disabled={!enabled}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Used for requests from users outside an organization')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='response_cache_setting.max_body_bytes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max cached body size (bytes)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1024}
                      max={MAX_BODY_UPPER_BOUND}
                      step={1024}
                      {...safeNumberFieldProps(field)}
                      disabled={!enabled}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Larger responses are served normally but never cached')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
