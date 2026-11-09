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
import { Fragment, type ReactNode } from 'react'

export function P(props: { children: ReactNode }) {
  return (
    <p className='text-muted-foreground text-sm leading-relaxed'>
      {props.children}
    </p>
  )
}

export function InlineCode(props: { children: ReactNode }) {
  return (
    <code className='bg-muted rounded px-1.5 py-0.5 font-mono text-xs'>
      {props.children}
    </code>
  )
}

export function Note(props: { children: ReactNode }) {
  return (
    <div className='border-border/70 bg-muted/40 text-muted-foreground rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed'>
      {props.children}
    </div>
  )
}

/** 渲染 i18n 译文：反引号包裹的片段渲染为行内代码，避免译文与 InlineCode 碎片拼接 */
export function DocText(props: { text: string }) {
  return (
    <>
      {props.text.split('`').map((part, i) =>
        i % 2 === 1 ? (
          <InlineCode key={i}>{part}</InlineCode>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  )
}
