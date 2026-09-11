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
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import { updateOrganization } from '../api'
import {
  ORG_ERROR_MESSAGES,
  ORG_NOTIFY_TARGET_PLACEHOLDERS,
  ORG_SUCCESS_MESSAGES,
  ORG_VALIDATION,
  getOrgNotifyTypeOptions,
  normalizeOrgNotifyType,
  type OrgNotifyType,
} from '../constants'
import type { UpdateOrganizationPayload } from '../types'
import { OrgNotifyProtocolHelp } from './org-notify-protocol-help'
import { useOrganization } from './organization-context'

/**
 * Thresholds are entered in the configured display currency and converted with
 * `parseQuotaFromDollars`, the same helper the user/quota forms use. `0` turns
 * an alert off, matching the backend's `< 0` validation and the "0 = disabled"
 * convention on `organizations.daily_usage_alert`.
 */
const settingsSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1)
    .max(ORG_VALIDATION.DISPLAY_NAME_MAX_LENGTH),
  warning_threshold: z.number().min(0),
  daily_usage_alert: z.number().min(0),
  notify_type: z.string(),
  notify_target: z.string().trim().max(ORG_VALIDATION.NOTIFY_TARGET_MAX_LENGTH),
  cache_enabled: z.boolean(),
  cache_ttl: z.number().int().min(1).max(ORG_VALIDATION.CACHE_TTL_MAX),
  allow_wallet_fallback: z.boolean(),
  hide_pool_quota: z.boolean(),
})

type SettingsFormInput = z.input<typeof settingsSchema>
type SettingsFormValues = z.output<typeof settingsSchema>

const EMPTY_DEFAULTS: SettingsFormInput = {
  display_name: '',
  warning_threshold: 0,
  daily_usage_alert: 0,
  notify_type: '',
  notify_target: '',
  cache_enabled: false,
  cache_ttl: ORG_VALIDATION.CACHE_TTL_DEFAULT,
  allow_wallet_fallback: false,
  hide_pool_quota: false,
}

export function OrganizationSettings() {
  const { t } = useTranslation()
  const { detail, triggerRefresh } = useOrganization()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const notifyTypeOptions = useMemo(() => getOrgNotifyTypeOptions(t), [t])

  const form = useForm<SettingsFormInput, unknown, SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: EMPTY_DEFAULTS,
  })

  const organization = detail?.organization
  const cacheSupported = detail?.cache_supported !== false

  useEffect(() => {
    if (!organization) return
    form.reset({
      display_name: organization.display_name || organization.name,
      warning_threshold:
        organization.warning_threshold > 0
          ? quotaUnitsToDollars(organization.warning_threshold)
          : 0,
      daily_usage_alert:
        organization.daily_usage_alert > 0
          ? quotaUnitsToDollars(organization.daily_usage_alert)
          : 0,
      notify_type: normalizeOrgNotifyType(organization.notify_type),
      notify_target: organization.notify_target ?? '',
      cache_enabled: organization.cache_enabled,
      cache_ttl:
        organization.cache_ttl > 0
          ? organization.cache_ttl
          : ORG_VALIDATION.CACHE_TTL_DEFAULT,
      allow_wallet_fallback: organization.allow_wallet_fallback,
      hide_pool_quota: organization.hide_pool_quota,
    })
  }, [organization, form])

  const notifyType = form.watch('notify_type') as OrgNotifyType
  const targetPlaceholder =
    ORG_NOTIFY_TARGET_PLACEHOLDERS[notifyType] ??
    ORG_NOTIFY_TARGET_PLACEHOLDERS['']

  const onSubmit = async (values: SettingsFormValues) => {
    setIsSubmitting(true)
    try {
      const payload: UpdateOrganizationPayload = {
        display_name: values.display_name,
        warning_threshold: parseQuotaFromDollars(values.warning_threshold),
        daily_usage_alert: parseQuotaFromDollars(values.daily_usage_alert),
        notify_type: values.notify_type,
        notify_target: values.notify_target,
        cache_enabled: values.cache_enabled,
        cache_ttl: values.cache_ttl,
        allow_wallet_fallback: values.allow_wallet_fallback,
        hide_pool_quota: values.hide_pool_quota,
      }
      const result = await updateOrganization(payload)
      if (!result.success) {
        toast.error(result.message || t(ORG_ERROR_MESSAGES.UPDATE_FAILED))
        return
      }
      toast.success(t(ORG_SUCCESS_MESSAGES.UPDATED))
      triggerRefresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!organization) {
    return null
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        className='space-y-4'
      >
        <Card>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>
              {t('General')}
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <FormItem>
              <FormLabel>{t('Organization Name')}</FormLabel>
              <Input value={organization.name} disabled />
              <FormDescription>
                {t(
                  'The identifier is fixed after creation; ask a system administrator to change it.'
                )}
              </FormDescription>
            </FormItem>
            <FormField
              control={form.control}
              name='display_name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Display Name')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>{t('Group')}</FormLabel>
              <Input value={organization.group} disabled />
              <FormDescription>
                {t(
                  'The group decides billing ratios and is managed by system administrators.'
                )}
              </FormDescription>
            </FormItem>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>
              {t('Quota Alerts')}
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='warning_threshold'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Pool Balance Alert Threshold')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='any'
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(event) =>
                          field.onChange(event.target.valueAsNumber || 0)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Notify when the pool balance drops below this amount. 0 disables the alert.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='daily_usage_alert'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Daily Usage Alert Threshold')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='any'
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(event) =>
                          field.onChange(event.target.valueAsNumber || 0)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        "Notify when today's organization usage exceeds this amount. 0 disables the alert."
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='notify_type'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Notification Channel')}</FormLabel>
                  <div className='flex items-center gap-1.5'>
                    <Select
                      value={field.value}
                      onValueChange={(value) => field.onChange(value ?? '')}
                    >
                      <FormControl>
                        <SelectTrigger className='flex-1'>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
                        {notifyTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <OrgNotifyProtocolHelp />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='notify_target'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Notification Target')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t(targetPlaceholder)} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Leave empty to notify every organization admin through their own account settings.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>
              {t('Response Cache')}
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {!cacheSupported ? (
              <Alert>
                <AlertDescription>
                  {t(
                    'Redis is not configured on this deployment, so response caching cannot be enabled.'
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            <FormField
              control={form.control}
              name='cache_enabled'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between gap-4 rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>{t('Enable Response Cache')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Identical text-only requests replay the stored response and are billed at zero quota.'
                      )}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value && cacheSupported}
                      disabled={!cacheSupported}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='cache_ttl'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Cache TTL (seconds)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      max={ORG_VALIDATION.CACHE_TTL_MAX}
                      value={Number.isFinite(field.value) ? field.value : ''}
                      onChange={(event) =>
                        field.onChange(event.target.valueAsNumber || 0)
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Maximum {{max}} seconds', {
                      max: ORG_VALIDATION.CACHE_TTL_MAX,
                    })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>
              {t('Pool Visibility & Fallback')}
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <FormField
              control={form.control}
              name='hide_pool_quota'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between gap-4 rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>{t('Hide Pool Balance From Members')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Members still see their own sub-quota, but not the shared pool balance.'
                      )}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='allow_wallet_fallback'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between gap-4 rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>{t('Fall Back To Personal Wallet')}</FormLabel>
                    <FormDescription>
                      {t(
                        "When the pool cannot cover a request, charge the member's personal balance instead of failing it."
                      )}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className='flex justify-end'>
          <Button type='submit' disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className='size-4 animate-spin' /> : null}
            {isSubmitting ? t('Saving...') : t('Save')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
