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
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { useAuthStore } from '@/stores/auth-store'

import { copyPromptTemplate, recordPromptTemplateUse } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import { canManagePromptTemplate } from '../lib'
import type { PromptTemplate } from '../types'
import { usePrompts } from './prompts-provider'

/**
 * Template actions shared by the row menu and the detail dialog.
 *
 * Keeping the handlers in one place matters because "duplicate" and "use in
 * playground" both have side effects (refreshing the list, incrementing the
 * usage counter) that must behave identically from either entry point.
 */
export function usePromptTemplateActions(prompt: PromptTemplate | null) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { triggerRefresh } = usePrompts()
  const user = useAuthStore((state) => state.auth.user)

  const canManage = prompt ? canManagePromptTemplate(prompt, user) : false

  // Copying the content is the most common action, so it stays available on
  // every template the user can read, including public ones they cannot edit.
  const copyContent = async () => {
    if (!prompt) return
    const ok = await copyToClipboard(prompt.content)
    if (ok) {
      toast.success(t(SUCCESS_MESSAGES.CONTENT_COPIED))
    } else {
      toast.error(t(ERROR_MESSAGES.COPY_CONTENT_FAILED))
    }
  }

  // Duplicating creates a private copy owned by the caller, which is how a
  // shared template becomes editable without touching the original.
  const duplicate = async () => {
    if (!prompt) return
    const result = await copyPromptTemplate(prompt.id)
    if (result.success) {
      toast.success(t(SUCCESS_MESSAGES.PROMPT_COPIED))
      triggerRefresh()
    } else {
      toast.error(result.message || t(ERROR_MESSAGES.COPY_FAILED))
    }
  }

  // The usage counter only feeds popularity ordering, so a failed increment
  // must not block the user from getting to the playground.
  const useInPlayground = () => {
    if (!prompt) return
    void recordPromptTemplateUse(prompt.id)
    void navigate({ to: '/playground', search: { prompt: prompt.content } })
  }

  return { canManage, copyContent, duplicate, useInPlayground }
}
