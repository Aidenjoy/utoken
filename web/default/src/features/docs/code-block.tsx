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
import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'

const JSON_TOKEN_SPLIT =
  /("(?:\\.|[^"\\])*"(?:\s*:)?|-?\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g

function highlightJson(code: string): ReactNode[] {
  return code.split(JSON_TOKEN_SPLIT).map((token, index) => {
    if (!token) return null
    let cls = 'text-zinc-300'
    if (/^".*"\s*:$/.test(token)) {
      cls = 'text-sky-300'
    } else if (token.startsWith('"')) {
      cls = 'text-emerald-300'
    } else if (/^-?\d/.test(token)) {
      cls = 'text-amber-300'
    } else if (/^(true|false|null)$/.test(token)) {
      cls = 'text-violet-300'
    }
    return (
      // 静态分词结果，顺序不可变
      // eslint-disable-next-line react/no-array-index-key
      <span key={index} className={cls}>
        {token}
      </span>
    )
  })
}

export type HttpMethod = 'GET' | 'POST'

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET: 'bg-sky-500/15 text-sky-400 ring-sky-500/30',
  POST: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
}

interface CodeBlockProps {
  code: string
  lang?: 'json' | 'bash'
  method?: HttpMethod
  url?: string
  title?: string
}

export function CodeBlock(props: CodeBlockProps) {
  const { copiedText, copyToClipboard } = useCopyToClipboard()
  const copied = copiedText === props.code

  return (
    <div className='overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-zinc-800/80 dark:ring-zinc-700/50'>
      <div className='flex items-center gap-2 border-b border-zinc-800/80 px-3.5 py-2'>
        {props.method ? (
          <span
            className={cn(
              'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide ring-1',
              METHOD_STYLES[props.method]
            )}
          >
            {props.method}
          </span>
        ) : null}
        <span className='min-w-0 flex-1 truncate font-mono text-xs text-zinc-400'>
          {props.url ?? props.title}
        </span>
        <button
          type='button'
          onClick={() => copyToClipboard(props.code)}
          className='shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200'
          aria-label='Copy code'
        >
          {copied ? (
            <Check className='size-3.5 text-emerald-400' />
          ) : (
            <Copy className='size-3.5' />
          )}
        </button>
      </div>
      <pre className='overflow-x-auto px-4 py-3.5 font-mono text-xs leading-relaxed'>
        <code>
          {props.lang === 'json' ? (
            highlightJson(props.code)
          ) : (
            <span className='text-zinc-300'>{props.code}</span>
          )}
        </code>
      </pre>
    </div>
  )
}
