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
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'

type EndpointMappingEditorProps = {
  models: string[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

// 方舟接入点（ep-）本质就是上游模型标识，直接复用 model_mapping 存储，
// 避免出现两份会互相漂移的配置；这里只提供按模型逐行填写的视图。
export function EndpointMappingEditor({
  models,
  value,
  onChange,
  disabled,
}: EndpointMappingEditorProps) {
  const { t } = useTranslation()

  let mapping: Record<string, unknown> | null = null
  try {
    const parsed = value.trim() ? JSON.parse(value) : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      mapping = parsed as Record<string, unknown>
    }
  } catch {
    mapping = null
  }

  if (mapping === null) {
    return (
      <Alert variant='destructive'>
        <AlertDescription>
          {t('Fix the Model Mapping JSON before configuring endpoints.')}
        </AlertDescription>
      </Alert>
    )
  }

  if (models.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          {t('Add models to the Models list before configuring endpoints.')}
        </AlertDescription>
      </Alert>
    )
  }

  const parsedMapping = mapping
  return (
    <div className='space-y-2'>
      {models.map((model) => {
        const target = parsedMapping[model]
        return (
          <div
            key={model}
            className='flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3'
          >
            <span
              className='text-muted-foreground w-56 shrink-0 truncate font-mono text-xs'
              title={model}
            >
              {model}
            </span>
            <Input
              value={typeof target === 'string' ? target : ''}
              placeholder={t(
                'ep-20260101xxxx-xxxx, leave empty to call with the model ID'
              )}
              disabled={disabled}
              onChange={(event) => {
                const next = { ...parsedMapping }
                const endpoint = event.target.value.trim()
                if (endpoint) {
                  next[model] = endpoint
                } else {
                  delete next[model]
                }
                onChange(
                  Object.keys(next).length > 0
                    ? JSON.stringify(next, null, 2)
                    : ''
                )
              }}
            />
          </div>
        )
      })}
    </div>
  )
}