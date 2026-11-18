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
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Loopback-only visual sandbox: no proxy, no .env, no real credentials or payments.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../dist'
)
const journal = '/private/tmp/yun-token-membership-mock-journal.jsonl'
const user = {
  id: 777,
  username: 'mock-admin',
  display_name: 'Mock administrator',
  role: 100,
  quota: 2000000,
  group: 'default',
  status: 1,
}
const channels = [
  {
    id: 7,
    name: 'Mock text channel',
    profile: 'openai_chat_text_v1',
    unit: 'input_output_tokens',
    models: ['gpt-4o-mini'],
  },
  {
    id: 8,
    name: 'Mock image channel',
    profile: 'openai_images_count_v1',
    unit: 'images',
    models: ['dall-e-2'],
  },
  {
    id: 9,
    name: 'Mock video channel',
    profile: 'sora_completed_video_v1',
    unit: 'completed_videos',
    models: ['sora-2', 'sora-2-pro'],
  },
]
const plan = {
  id: 101,
  title: 'Mock 渠道会员',
  subtitle: '仅模拟数据，不会产生真实扣款',
  meter_type: 'channel',
  channel_quotas: [
    {
      channel_id: 7,
      profile: channels[0].profile,
      unit: channels[0].unit,
      models: channels[0].models,
      input_limit: 1000000,
      output_limit: 200000,
    },
    {
      channel_id: 8,
      profile: channels[1].profile,
      unit: channels[1].unit,
      models: channels[1].models,
      input_limit: 0,
      output_limit: 0,
      quantity_limit: 100,
    },
    {
      channel_id: 9,
      profile: channels[2].profile,
      unit: channels[2].unit,
      models: channels[2].models,
      input_limit: 0,
      output_limit: 0,
      quantity_limit: 5,
    },
  ],
  price_amount: 1,
  currency: 'USD',
  duration_unit: 'month',
  duration_value: 1,
  total_amount: 0,
  quota_reset_period: 'never',
  max_purchase_per_user: 0,
  enabled: true,
  sort_order: 1,
  allow_balance_pay: true,
  allow_wallet_overflow: false,
}
const plans = [plan]
const subscriptions = []
const keys = []

// The journal is append-only; restarting the sandbox replays its synthetic changes.
function applyEvent(event) {
  if (event.kind === 'purchase') {
    subscriptions.push(event.record)
    user.quota -= event.cost
  }
  if (event.kind === 'key') keys.push(event.key)
  if (event.kind === 'plan') plans.push(event.plan)
}
try {
  for (const line of (await fs.readFile(journal, 'utf8'))
    .split('\n')
    .filter(Boolean)) {
    applyEvent(JSON.parse(line))
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

async function saveEvent(event) {
  await fs.appendFile(journal, `${JSON.stringify(event)}\n`)
  applyEvent(event)
}

const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
}
// Mirror the user-facing API projection while retaining full synthetic admin rights.
function publicBenefit(grant) {
  const benefit = {
    id: grant.id,
    user_subscription_id: grant.user_subscription_id,
    channel_id: grant.channel_id,
    profile: grant.profile,
    unit: grant.unit,
    models: grant.models,
  }
  if (grant.user_subscription_id) {
    benefit.available =
      grant.unit === 'input_output_tokens'
        ? grant.input_limit > grant.input_used + grant.input_reserved &&
          grant.output_limit > grant.output_used + grant.output_reserved
        : grant.quantity_limit > grant.quantity_used + grant.quantity_reserved
  }
  return benefit
}
function publicSubscription(record) {
  return { ...record, channel_quotas: record.channel_quotas.map(publicBenefit) }
}
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:5189')
    response.setHeader('X-Channel-Membership-Mode', 'mock-only')
    response.setHeader(
      'Content-Security-Policy',
      "connect-src 'self'; form-action 'self'; frame-src 'none'"
    )
    if (url.pathname.startsWith('/api/')) {
      let body = {}
      if (request.method === 'POST') {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const raw = Buffer.concat(chunks).toString()
        if (raw) body = JSON.parse(raw)
      }
      let data = []
      let success = true
      let message = 'success'
      const endpoint = url.pathname.replace(/\/$/, '')
      if (request.method === 'DELETE') {
        success = false
        message = 'Mock preview never deletes data'
      } else if (endpoint === '/api/setup') data = { status: true }
      else if (endpoint === '/api/status') {
        data = {
          setup: true,
          system_name: 'new-api',
          version: 'mock-only',
          start_time: 1,
        }
      } else if (endpoint === '/api/notice') data = ''
      else if (endpoint === '/api/user/self') data = user
      else if (endpoint === '/api/group') data = ['default']
      else if (endpoint === '/api/option') {
        data = [
          { key: 'payment_setting.compliance_confirmed', value: 'true' },
          { key: 'payment_setting.compliance_terms_version', value: 'v1' },
        ]
      } else if (endpoint === '/api/subscription/admin/channels') {
        data = channels
      } else if (endpoint === '/api/subscription/self') {
        data = {
          billing_preference: 'wallet_first',
          subscriptions: subscriptions.map(publicSubscription),
          all_subscriptions: subscriptions.map(publicSubscription),
        }
      } else if (endpoint === '/api/user/topup/info') {
        data = {
          enable_online_topup: false,
          enable_stripe_topup: false,
          pay_methods: [],
        }
      } else if (
        endpoint === '/api/subscription/balance/pay' &&
        request.method === 'POST'
      ) {
        const selected = plans.find((item) => item.id === body.plan_id)
        const cost = Math.ceil((selected?.price_amount ?? 0) * 500000)
        if (!selected || user.quota < cost) {
          success = false
          message = 'Mock balance insufficient'
        } else {
          const id = 501 + subscriptions.length
          const now = Math.floor(Date.now() / 1000)
          const record = {
            subscription: {
              id,
              user_id: user.id,
              plan_id: selected.id,
              meter_type: 'channel',
              status: 'active',
              start_time: now,
              end_time: now + 30 * 86400,
              amount_total: 0,
              amount_used: 0,
            },
            channel_quotas: selected.channel_quotas.map((grant) => ({
              ...grant,
              id: id * 100 + grant.channel_id,
              user_subscription_id: id,
              input_used: 0,
              output_used: 0,
              input_reserved: 0,
              output_reserved: 0,
              quantity_limit: grant.quantity_limit ?? 0,
              quantity_used: 0,
              quantity_reserved: 0,
            })),
          }
          await saveEvent({ kind: 'purchase', record, cost })
          data = {}
        }
      } else if (endpoint === '/api/token' && request.method === 'POST') {
        const grant = subscriptions
          .find((item) => item.subscription.id === body.user_subscription_id)
          ?.channel_quotas.find((item) => item.channel_id === body.channel_id)
        if (!grant) {
          success = false
          message = 'Mock membership grant not found'
        } else {
          const key = {
            ...body,
            id: 800 + keys.length,
            key: `mock-member-${800 + keys.length}`,
            status: 1,
            user_id: user.id,
            remain_quota: 0,
            used_quota: 0,
          }
          await saveEvent({ kind: 'key', key })
          data = key
        }
      } else if (endpoint === '/api/token') {
        data = { items: keys, total: keys.length, page: 1, page_size: 10 }
      } else if (/^\/api\/token\/\d+\/key$/.test(endpoint)) {
        data = {
          key:
            keys.find((key) => key.id === Number(endpoint.split('/')[3]))
              ?.key ?? 'mock-key',
        }
      } else if (
        endpoint === '/api/subscription/admin/plans' &&
        request.method === 'POST'
      ) {
        const created = { ...body.plan, id: 101 + plans.length }
        await saveEvent({ kind: 'plan', plan: created })
        data = { plan: created }
      } else if (
        endpoint === '/api/subscription/plans' ||
        endpoint === '/api/subscription/admin/plans'
      ) {
        data = plans.map((item) => ({
          plan:
            endpoint === '/api/subscription/plans'
              ? {
                  ...item,
                  channel_quotas: item.channel_quotas.map(publicBenefit),
                }
              : item,
        }))
      } else if (request.method !== 'GET') {
        success = false
        message = 'This operation is not implemented in the mock preview'
      }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ success, message, data }))
      return
    }
    const target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403)
      response.end()
      return
    }
    const file = await fs.stat(target).catch(() => null)
    if (file?.isFile()) {
      response.setHeader(
        'Content-Type',
        mime[path.extname(target)] ?? 'application/octet-stream'
      )
      createReadStream(target).pipe(response)
      return
    }
    const bootstrap = `<script>localStorage.setItem('user',${JSON.stringify(JSON.stringify(user))});if(!localStorage.getItem('i18nextLng'))localStorage.setItem('i18nextLng','zhCN')</script>`
    const html = (
      await fs.readFile(path.join(root, 'index.html'), 'utf8')
    ).replace('</head>', `${bootstrap}</head>`)
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(
      html.replace(
        '<body>',
        '<body><div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#fef3c7;color:#78350f;text-align:center;font-size:12px;padding:4px">MOCK 预览：全部为模拟账户与额度，不会产生真实扣款，不连接业务数据库。</div>'
      )
    )
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        success: false,
        message: `Mock preview: ${error.message}`,
      })
    )
  }
})
server.listen(5189, '127.0.0.1', () =>
  console.log('Mock-only membership preview: http://127.0.0.1:5189/memberships')
)
