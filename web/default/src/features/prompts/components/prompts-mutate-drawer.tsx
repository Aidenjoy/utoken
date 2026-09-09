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
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
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
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  createPromptTemplate,
  getPromptTemplate,
  updatePromptTemplate,
} from '../api'
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  getSelectablePromptVisibilities,
} from '../constants'
import {
  getPromptFormDefaultValues,
  getPromptFormSchema,
  type PromptFormValues,
  transformFormDataToPayload,
  transformPromptToFormDefaults,
} from '../lib'
import { PROMPT_VISIBILITY, type PromptTemplate } from '../types'
import { usePrompts } from './prompts-provider'

type PromptsMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: PromptTemplate
}

export function PromptsMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: PromptsMutateDrawerProps) {
  const { t } = useTranslation()
  const isUpdate = !!currentRow
  const { triggerRefresh } = usePrompts()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const user = useAuthStore((state) => state.auth.user)

  const visibilityOptions = useMemo(
    () =>
      getSelectablePromptVisibilities(t, {
        hasOrg: (user?.org_id ?? 0) > 0,
        isRoot: (user?.role ?? 0) >= ROLE.SUPER_ADMIN,
      }),
    [t, user?.org_id, user?.role]
  )

  const form = useForm<PromptFormValues>({
    resolver: zodResolver(getPromptFormSchema(t)),
    defaultValues: getPromptFormDefaultValues(),
  })

  useEffect(() => {
    if (!open) return

    if (!isUpdate || !currentRow) {
      // Organization members default to sharing inside the organization, which
      // is the whole point of the shared library; everyone else starts private.
      const defaultVisibility =
        (user?.org_id ?? 0) > 0
          ? PROMPT_VISIBILITY.ORG
          : PROMPT_VISIBILITY.PRIVATE
      form.reset(getPromptFormDefaultValues(defaultVisibility))
      return
    }

    // The list may come from a search result, so refetch before editing.
    getPromptTemplate(currentRow.id)
      .then((result) => {
        if (result.success && result.data) {
          form.reset(transformPromptToFormDefaults(result.data))
        } else {
          form.reset(transformPromptToFormDefaults(currentRow))
        }
      })
      .catch(() => {
        // A failed refetch must not leave the drawer blank: fall back to the
        // row already loaded in the list so editing stays possible.
        form.reset(transformPromptToFormDefaults(currentRow))
      })
  }, [open, isUpdate, currentRow, form, user?.org_id])

  const onSubmit = async (data: PromptFormValues) => {
    setIsSubmitting(true)
    try {
      const payload = transformFormDataToPayload(data)

      const result =
        isUpdate && currentRow
          ? await updatePromptTemplate(currentRow.id, payload)
          : await createPromptTemplate(payload)

      if (!result.success) {
        toast.error(
          result.message ||
            t(
              isUpdate
                ? ERROR_MESSAGES.UPDATE_FAILED
                : ERROR_MESSAGES.CREATE_FAILED
            )
        )
        return
      }

      toast.success(
        t(
          isUpdate
            ? SUCCESS_MESSAGES.PROMPT_UPDATED
            : SUCCESS_MESSAGES.PROMPT_CREATED
        )
      )
      onOpenChange(false)
      triggerRefresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    void form.handleSubmit(onSubmit)(event)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) form.reset()
      }}
    >
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[640px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate
              ? t('Update Prompt Template')
              : t('Create Prompt Template')}
          </SheetTitle>
          <SheetDescription>
            {isUpdate
              ? t('Update the prompt template by providing necessary info.')
              : t(
                  'Save a prompt so you can reuse it across conversations.'
                )}{' '}
            {t("Click save when you're done.")}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='prompt-form'
            onSubmit={handleSubmit}
            className={sideDrawerFormClassName()}
          >
            <SideDrawerSection>
              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Title')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('Enter a title')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='content'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Content')}</FormLabel>
                    <FormControl>
                      <Textarea
                        className='min-h-56 font-mono text-xs'
                        placeholder={t('Enter the prompt content')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'The prompt sent to the model, including any placeholders.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='description'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Description')}</FormLabel>
                    <FormControl>
                      <Textarea
                        className='min-h-16'
                        placeholder={t('Describe when to use this prompt')}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='tags'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Tags')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t('coding, review, translation')}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Separate tags with commas.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='visibility'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Visibility')}</FormLabel>
                    <Select
                      items={visibilityOptions.map((opt) => ({
                        value: opt.value,
                        label: opt.label,
                      }))}
                      value={field.value}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <FormControl>
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder={t('Select')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {visibilityOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <span>{opt.label}</span>
                              <span className='text-muted-foreground ml-2 text-xs'>
                                {opt.description}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SideDrawerSection>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button form='prompt-form' type='submit' disabled={isSubmitting}>
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
