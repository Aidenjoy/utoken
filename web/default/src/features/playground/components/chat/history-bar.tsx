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

import { Button } from '@/components/ui/button'

import type { useHistory } from '../../hooks/use-history'

type Props = { history: ReturnType<typeof useHistory>; disabled: boolean }

/** Account-owned history controls; reads never dispatch a chat request. */
export function HistoryBar(props: Props) {
  const { t } = useTranslation()
  const history = props.history
  const locked = props.disabled || history.saving || history.dirty
  return (
    <div className='flex flex-wrap items-center gap-2 border-b p-2 text-sm'>
      <label htmlFor='conversation-history'>{t('Conversation history')}</label>
      <select
        id='conversation-history'
        className='bg-background max-w-64 rounded-md border p-1'
        value={
          history.conversations.some((item) => item.id === history.id)
            ? history.id
            : ''
        }
        disabled={locked}
        onChange={(event) => {
          if (event.target.value) void history.open(event.target.value)
        }}
      >
        <option value=''>{t('New conversation')}</option>
        {history.conversations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title || t('New conversation')}
          </option>
        ))}
      </select>
      <Button variant='ghost' disabled={locked} onClick={history.clearMessages}>
        {t('New conversation')}
      </Button>
      <Button
        variant='ghost'
        disabled={locked}
        onClick={() => {
          void history.reload()
        }}
      >
        {t('Refresh')}
      </Button>
      {history.offset > 0 && (
        <Button
          variant='ghost'
          disabled={locked}
          onClick={() => history.setOffset(Math.max(0, history.offset - 30))}
        >
          {t('Previous')}
        </Button>
      )}
      {history.moreConversations && (
        <Button
          variant='ghost'
          disabled={locked}
          onClick={() => history.setOffset(history.offset + 30)}
        >
          {t('Next')}
        </Button>
      )}
      {history.moreMessages && (
        <Button
          variant='ghost'
          disabled={locked}
          onClick={() => {
            void history.open(history.id, true)
          }}
        >
          {t('Load older messages')}
        </Button>
      )}
      {history.moreMessages && (
        <span>
          {t('Load older messages before continuing this conversation.')}
        </span>
      )}
      {history.saving && <span role='status'>{t('Saving...')}</span>}
      {history.error && (
        <span role='alert' className='text-destructive'>
          {t('History sync failed. Local messages are retained.')}
          <Button
            variant='ghost'
            disabled={props.disabled || history.saving}
            onClick={history.retrySave}
          >
            {t('Retry')}
          </Button>
          <Button
            variant='ghost'
            disabled={props.disabled || history.saving}
            onClick={history.saveCopy}
          >
            {t('Save local messages as a new conversation')}
          </Button>
        </span>
      )}
    </div>
  )
}
