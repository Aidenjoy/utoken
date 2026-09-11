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
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/**
 * OrgNotifyProtocolHelp is the info trigger rendered next to the notification
 * channel select. The dialog documents, for every channel, what recipients
 * actually receive (mail subject/body, webhook method, headers and JSON body)
 * so operators can integrate without reading the backend source.
 */
export function OrgNotifyProtocolHelp() {
  const { t } = useTranslation()
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='shrink-0 text-muted-foreground'
          />
        }
      >
        <Info className='size-4' />
        <span className='sr-only'>{t('Alert Delivery Protocol')}</span>
      </DialogTrigger>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Alert Delivery Protocol')}</DialogTitle>
          <DialogDescription>
            {t('What each notification channel sends and how to integrate it.')}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <section className='space-y-1'>
            <h4 className='text-sm font-medium'>
              {t('All organization admins')}
            </h4>
            <p className='text-muted-foreground text-sm'>
              {t(
                'No integration needed. The alert is delivered to every enabled organization admin (or the usernames in Notification Target) through the notification method each admin configured in their profile; email is used when they have not configured one. The message itself matches the email example below.'
              )}
            </p>
          </section>
          <section className='space-y-1'>
            <h4 className='text-sm font-medium'>{t('Email')}</h4>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Sent to the notification email from the recipient profile settings, falling back to the account email. The subject is the alert title and the body is the alert text with all values filled in.'
              )}
            </p>
            <pre className='bg-muted text-foreground overflow-x-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap'>
              {t(
                'Subject: Organization ACME quota pool running low\nBody: Organization ACME has $1.08 left in the quota pool, below the warning threshold $5.00. Top up in time to keep members working.'
              )}
            </pre>
          </section>
          <section className='space-y-1'>
            <h4 className='text-sm font-medium'>{t('Webhook')}</h4>
            <p className='text-muted-foreground text-sm'>
              {t(
                'One HTTP POST per alert to the webhook URL from the recipient profile settings, with Content-Type: application/json. Any 2xx response status counts as delivered; the request is skipped when the recipient has no webhook URL.'
              )}
            </p>
            <p className='text-muted-foreground text-sm'>
              {t(
                'When the recipient configured a webhook secret, requests also carry Authorization: Bearer <secret> and X-Webhook-Signature, the HMAC-SHA256 hex digest of the raw request body keyed by the secret.'
              )}
            </p>
            <pre className='bg-muted text-foreground overflow-x-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap'>
              {t(
                '{\n  "type": "quota_exceed",\n  "title": "Organization ACME quota pool running low",\n  "content": "Organization ACME has $1.08 left in the quota pool, below the warning threshold $5.00. Top up in time to keep members working.",\n  "values": ["ACME", "$1.08", "$5.00"],\n  "timestamp": 1760000000\n}'
              )}
            </pre>
            <p className='text-muted-foreground text-sm'>
              {t(
                'type is quota_exceed for every organization quota alert; values lists, in order, the raw values substituted into content.'
              )}
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
