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
import { Loader2, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'

import { SettingsSection } from '../components/settings-section'

type TokenRow = { context: string; maxOutput: string; enabled: boolean }

type ModelInfoRecord = {
  model_name: string
  context_window: number
  max_output_tokens: number
  enabled: boolean | null
}

// 与后端存储契约一致：整数 token。UI 接受 K/M 简写（K=1024，M=1024²）。
function parseTokenInput(raw: string): number | null {
  const value = raw.trim()
  if (!value) return 0
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(value)
  if (!match) return null
  let multiplier = 1
  const unit = match[2]?.toLowerCase()
  if (unit === 'm') multiplier = 1024 * 1024
  if (unit === 'k') multiplier = 1024
  return Math.round(Number(match[1]) * multiplier)
}

function formatTokenValue(value: number): string {
  if (!value) return ''
  if (value % (1024 * 1024) === 0) return `${value / (1024 * 1024)}M`
  if (value % 1024 === 0) return `${value / 1024}K`
  return String(value)
}

export function ModelInfoSection() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [languageModels, setLanguageModels] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, TokenRow>>({})
  const [savedRows, setSavedRows] = useState<Record<string, TokenRow>>({})
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await api.get('/api/model_info')
        if (cancelled || !res.data?.success) return
        const models: string[] = res.data.data?.language_models ?? []
        const infos: ModelInfoRecord[] = res.data.data?.infos ?? []
        const infoMap = new Map(infos.map((info) => [info.model_name, info]))
        const next: Record<string, TokenRow> = {}
        for (const name of models) {
          const info = infoMap.get(name)
          next[name] = {
            context: formatTokenValue(info?.context_window ?? 0),
            maxOutput: formatTokenValue(info?.max_output_tokens ?? 0),
            enabled: info?.enabled ?? true,
          }
        }
        setLanguageModels(models)
        setRows(next)
        setSavedRows(next)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const dirty = JSON.stringify(rows) !== JSON.stringify(savedRows)
  const filteredModels = keyword.trim()
    ? languageModels.filter((name) =>
        name.toLowerCase().includes(keyword.trim().toLowerCase())
      )
    : languageModels

  // 仅更新 token 文本；展示状态由开关独立更新。
  function updateRow(
    name: string,
    field: 'context' | 'maxOutput',
    value: string
  ) {
    setRows((prev) => ({ ...prev, [name]: { ...prev[name], [field]: value } }))
  }

  async function handleSave() {
    const infos: ModelInfoRecord[] = []
    for (const name of languageModels) {
      const row = rows[name] ?? { context: '', maxOutput: '', enabled: true }
      const context = parseTokenInput(row.context)
      const maxOutput = parseTokenInput(row.maxOutput)
      if (context === null || maxOutput === null) {
        toast.error(t('Invalid token count for {{model}}', { model: name }))
        return
      }
      infos.push({
        model_name: name,
        context_window: context,
        max_output_tokens: maxOutput,
        enabled: row.enabled,
      })
    }
    setSaving(true)
    try {
      const res = await api.put('/api/model_info', { infos })
      if (res.data?.success) {
        toast.success(t('Model info saved successfully'))
        setSavedRows(rows)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection title={t('Model Info')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Configure the context window and max output tokens for language models. Configured values are returned by /v1/modelsinfo.'
        )}
      </p>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Enter a number or a value like 128K / 1M (K = 1024, M = 1048576). Leave empty to clear.'
        )}
      </p>
      {loading ? (
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Loader2 className='size-4 animate-spin' />
          {t('Loading...')}
        </div>
      ) : (
        <>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('Search models')}
            className='max-w-sm'
          />
          {filteredModels.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {t('No models found')}
            </p>
          ) : (
            <div className='flex flex-col gap-2'>
              <div className='text-muted-foreground hidden gap-3 text-xs font-medium sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'>
                <span>{t('Model')}</span>
                <span>{t('Context Window')}</span>
                <span>{t('Max Output Tokens')}</span>
                <span>{t('Enabled')}</span>
              </div>
              {filteredModels.map((name) => (
                <div
                  key={name}
                  className='grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-3'
                >
                  <span className='truncate font-mono text-sm' title={name}>
                    {name}
                  </span>
                  <Input
                    value={rows[name]?.context ?? ''}
                    onChange={(e) => updateRow(name, 'context', e.target.value)}
                    placeholder='1M'
                    aria-label={`${name} - ${t('Context Window')}`}
                    disabled={saving}
                  />
                  <Input
                    value={rows[name]?.maxOutput ?? ''}
                    onChange={(e) =>
                      updateRow(name, 'maxOutput', e.target.value)
                    }
                    placeholder='128K'
                    aria-label={`${name} - ${t('Max Output Tokens')}`}
                    disabled={saving}
                  />
                  <label className='flex items-center gap-2 text-sm'>
                    <Switch
                      checked={rows[name]?.enabled ?? true}
                      onCheckedChange={(enabled) =>
                        setRows((prev) => ({
                          ...prev,
                          [name]: { ...prev[name], enabled },
                        }))
                      }
                      aria-label={`${name} - ${t('Enabled')}`}
                      disabled={saving}
                    />
                    {rows[name]?.enabled ? t('Enabled') : t('Disabled')}
                  </label>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button
              type='button'
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? (
                <Loader2 data-icon='inline-start' className='animate-spin' />
              ) : (
                <Save data-icon='inline-start' />
              )}
              {t('Save Model Info')}
            </Button>
          </div>
        </>
      )}
    </SettingsSection>
  )
}
