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
import { Mail } from 'lucide-react'
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

import { adminBindUserEmail } from '../../api'
import {
  getUserEmailBindFormSchema,
  USER_EMAIL_BIND_FORM_DEFAULT_VALUES,
  type UserEmailBindFormValues,
} from '../../lib/user-email-bind-form'
import type { User } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: Pick<User, 'id' | 'username'> | null
  onSuccess?: () => void
}

/**
 * Admin-side email binding for accounts created without one. Accounts that
 * already have an email never reach this dialog — the row action toasts
 * "already bound" instead — and the server enforces the same rule.
 */
export function UserEmailBindDialog(props: Props) {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<UserEmailBindFormValues>({
    resolver: zodResolver(getUserEmailBindFormSchema(t)),
    defaultValues: USER_EMAIL_BIND_FORM_DEFAULT_VALUES,
  })

  useEffect(() => {
    if (props.open) {
      form.reset(USER_EMAIL_BIND_FORM_DEFAULT_VALUES)
    }
  }, [props.open, form])

  const onSubmit = async (values: UserEmailBindFormValues) => {
    if (!props.user) return
    setIsSubmitting(true)
    try {
      const result = await adminBindUserEmail(props.user.id, values.email)
      if (!result.success) {
        toast.error(result.message || t('Failed to bind email'))
        return
      }
      toast.success(t('Email bound successfully!'))
      props.onSuccess?.()
      props.onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <Mail className='h-5 w-5' />
          {t('Bind Email')}
        </>
      }
      description={
        props.user
          ? t(
              'Bind a login email for {{username}}. The account can then use it for login and password recovery.',
              { username: props.user.username }
            )
          : undefined
      }
      contentClassName='sm:max-w-md'
      titleClassName='flex items-center gap-2'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className='space-y-4'
          id='user-email-bind-form'
        >
          <FormField
            control={form.control}
            name='email'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Email')}</FormLabel>
                <FormControl>
                  <Input
                    type='email'
                    autoComplete='off'
                    placeholder={t('Enter your email')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type='submit' className='w-full' disabled={isSubmitting}>
            {t('Bind Email')}
          </Button>
        </form>
      </Form>
    </Dialog>
  )
}
