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
import { Copy, KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { createApiKey, fetchTokenKey } from '@/features/keys/api'
import { ERROR_MESSAGES } from '@/features/keys/constants'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'

import {
  getUserApiKeyFormSchema,
  USER_API_KEY_FORM_DEFAULT_VALUES,
  transformUserApiKeyFormToPayload,
  type UserApiKeyFormValues,
} from '../../lib'
import type { User } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: Pick<User, 'id' | 'username'> | null
}

export function UserApiKeyCreateDialog(props: Props) {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  const schema = getUserApiKeyFormSchema(t)
  const form = useForm<UserApiKeyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: USER_API_KEY_FORM_DEFAULT_VALUES,
  })

  useEffect(() => {
    if (props.open) {
      form.reset(USER_API_KEY_FORM_DEFAULT_VALUES)
      setCreatedKey(null)
    }
  }, [props.open, form])

  const onSubmit = async (values: UserApiKeyFormValues) => {
    if (!props.user) return
    setIsSubmitting(true)
    try {
      const result = await createApiKey(
        transformUserApiKeyFormToPayload(values, props.user.id)
      )
      if (!result.success || !result.data) {
        toast.error(result.message || t(ERROR_MESSAGES.CREATE_FAILED))
        return
      }
      const keyResult = await fetchTokenKey(result.data.id)
      setCreatedKey(keyResult.data?.key || null)
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopy = async () => {
    if (!createdKey) return
    const ok = await copyToClipboard(createdKey)
    if (ok) toast.success(t('Copied'))
  }

  const unlimitedQuota = form.watch('unlimited_quota')
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const quotaLabel = t('Quota ({{currency}})', { currency: currencyLabel })
  const quotaPlaceholder =
    currencyMeta.kind === 'tokens'
      ? t('Enter quota in tokens')
      : t('Enter quota in {{currency}}', { currency: currencyLabel })

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <KeyRound className='h-5 w-5' />
          {t('Create API Key')}
        </>
      }
      description={
        props.user
          ? t('Create an API key for {{username}}', {
              username: props.user.username,
            })
          : undefined
      }
      contentClassName='sm:max-w-md'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      {createdKey !== null ? (
        <div className='space-y-3'>
          <p className='text-sm'>
            {t('API key created. Copy it now:')}
          </p>
          {createdKey ? (
            <div className='flex items-center gap-2'>
              <Input
                readOnly
                value={createdKey}
                className='font-mono text-xs'
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                variant='outline'
                size='icon'
                onClick={handleCopy}
                aria-label={t('Copy Key')}
              >
                <Copy className='h-4 w-4' />
              </Button>
            </div>
          ) : (
            <p className='text-muted-foreground text-xs'>
              {t('You can copy the key from the API Keys list.')}
            </p>
          )}
          <Button
            className='w-full'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Close')}
          </Button>
        </div>
      ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4'
            id='user-api-key-create-form'
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Name')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('Enter a name')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='unlimited_quota'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <FormLabel>{t('Unlimited Quota')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {!unlimitedQuota && (
              <FormField
                control={form.control}
                name='remain_quota_dollars'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{quotaLabel}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='0.01'
                        placeholder={quotaPlaceholder}
                        value={field.value}
                        onChange={(event) =>
                          field.onChange(event.target.valueAsNumber)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button type='submit' className='w-full' disabled={isSubmitting}>
              {t('Create')}
            </Button>
          </form>
        </Form>
      )}
    </Dialog>
  )
}
