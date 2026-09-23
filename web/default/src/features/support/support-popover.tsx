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
import { Mail, QrCode } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useStatus } from '@/hooks/use-status'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type SupportPopoverProps = {
  /** 触发按钮样式，需与所在导航/页脚的其它链接保持一致。 */
  triggerClassName?: string
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

/**
 * 联系客服弹窗：点击后在触发元素下方弹出管理员在系统设置「系统信息」中
 * 维护的客服二维码与联系方式，取代原来的独立跳转页面。
 */
export function SupportPopover({
  triggerClassName,
  align = 'center',
  sideOffset = 10,
}: SupportPopoverProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const record = status as Record<string, unknown> | null
  const qrCode = (record?.support_qrcode as string | undefined)?.trim() ?? ''
  const contact = (record?.support_contact as string | undefined)?.trim() ?? ''
  const isEmail = EMAIL_PATTERN.test(contact)
  const hasContent = Boolean(qrCode || contact)

  return (
    <Popover>
      <PopoverTrigger
        render={<button type='button' className={triggerClassName} />}
      >
        {t('Contact Support')}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={sideOffset}
        className='w-72 gap-3 p-4'
      >
        <div className='text-center'>
          <p className='text-sm font-medium'>{t('Contact Support')}</p>
          {hasContent ? (
            <p className='text-muted-foreground mt-1 text-xs leading-relaxed'>
              {t('Scan the QR code to add us and get in touch.')}
            </p>
          ) : null}
        </div>

        {hasContent ? (
          <div className='flex flex-col items-center gap-4'>
            {qrCode ? (
              <figure className='flex flex-col items-center gap-2'>
                <img
                  src={qrCode}
                  alt={t('QQ QR Code')}
                  width={176}
                  height={176}
                  decoding='async'
                  className='border-border bg-card size-44 rounded-xl border object-contain p-2'
                />
                <figcaption className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                  <QrCode className='size-3.5' aria-hidden='true' />
                  {t('QQ QR Code')}
                </figcaption>
              </figure>
            ) : null}
            {contact ? (
              <div className='text-center'>
                <span className='text-muted-foreground mb-1.5 block text-xs'>
                  {t('Or email us')}
                </span>
                {isEmail ? (
                  <a
                    href={`mailto:${contact}`}
                    className='text-primary inline-flex items-center gap-2 text-sm font-medium hover:underline'
                  >
                    <Mail className='size-4 shrink-0' aria-hidden='true' />
                    <span className='break-all'>{contact}</span>
                  </a>
                ) : (
                  <span className='text-foreground inline-flex items-center gap-2 text-sm font-medium'>
                    <Mail className='size-4 shrink-0' aria-hidden='true' />
                    <span className='break-all'>{contact}</span>
                  </span>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <p className='text-muted-foreground border-border rounded-xl border border-dashed p-6 text-center text-xs leading-relaxed'>
            {t(
              'Support contact information has not been configured yet. Please check back later.'
            )}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
