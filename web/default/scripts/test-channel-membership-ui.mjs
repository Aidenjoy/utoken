import fs from 'node:fs/promises'
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
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright-core')

const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  locale: 'en-US',
})
const user = {
  id: 777,
  username: 'mock-admin',
  display_name: 'Mock administrator',
  role: 100,
  quota: 2000000,
  group: 'default',
  status: 1,
}
await context.addInitScript((user) => {
  localStorage.setItem('user', JSON.stringify(user))
  if (!localStorage.getItem('i18nextLng')) {
    localStorage.setItem('i18nextLng', 'en')
  }
}, user)
let purchased = false,
  created = false,
  imageCreated = false,
  videoCreated = false,
  adminSaved = false
const operations = []
const quota = {
  id: 1,
  user_subscription_id: 501,
  channel_id: 7,
  profile: 'openai_chat_text_v1',
  unit: 'input_output_tokens',
  models: ['gpt-4o-mini'],
  input_limit: 1000000,
  output_limit: 200000,
  input_used: 120,
  input_reserved: 50,
  output_used: 80,
  output_reserved: 20,
}
const imageQuota = {
  id: 2,
  user_subscription_id: 501,
  channel_id: 8,
  profile: 'openai_images_count_v1',
  unit: 'images',
  models: ['dall-e-2'],
  input_limit: 0,
  output_limit: 0,
  input_used: 0,
  output_used: 0,
  input_reserved: 0,
  output_reserved: 0,
  quantity_limit: 10,
  quantity_used: 2,
  quantity_reserved: 1,
}
const videoQuota = {
  ...imageQuota,
  id: 3,
  channel_id: 9,
  profile: 'sora_completed_video_v1',
  unit: 'completed_videos',
  models: ['sora-2', 'sora-2-pro'],
  quantity_limit: 5,
  quantity_used: 1,
  quantity_reserved: 1,
}
const plan = {
  id: 101,
  title: 'Mock channel membership',
  subtitle: 'Mock-only test plan',
  meter_type: 'channel',
  channel_quotas: [
    {
      channel_id: 7,
      profile: quota.profile,
      unit: quota.unit,
      models: quota.models,
      input_limit: quota.input_limit,
      output_limit: quota.output_limit,
    },
    {
      channel_id: 8,
      profile: imageQuota.profile,
      unit: imageQuota.unit,
      models: imageQuota.models,
      input_limit: 0,
      output_limit: 0,
      quantity_limit: 10,
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
const record = {
  subscription: {
    id: 501,
    user_id: 777,
    plan_id: 101,
    meter_type: 'channel',
    status: 'active',
    start_time: Math.floor(Date.now() / 1000) - 60,
    end_time: Math.floor(Date.now() / 1000) + 86400,
    amount_total: 0,
    amount_used: 0,
  },
  channel_quotas: [quota, imageQuota, videoQuota],
}
// Match the user API contract: no internal allowance figures reach the page.
function publicBenefit(grant) {
  return {
    id: grant.id,
    user_subscription_id: grant.user_subscription_id,
    channel_id: grant.channel_id,
    profile: grant.profile,
    unit: grant.unit,
    models: grant.models,
    available: true,
  }
}
const publicPlan = {
  ...plan,
  channel_quotas: plan.channel_quotas.map(publicBenefit),
}
const publicRecord = {
  ...record,
  channel_quotas: record.channel_quotas.map(publicBenefit),
}
await context.route('**/*', async (route) => {
  const req = route.request()
  const url = new URL(req.url())
  if (url.pathname.startsWith('/api/')) {
    let data = []
    const method = req.method()
    operations.push({ path: url.pathname, method })
    if (url.pathname === '/api/subscription/admin/plans' && method === 'POST') {
      const payload = req.postDataJSON().plan
      if (
        payload.meter_type !== 'channel' ||
        payload.channel_quotas[0].input_limit !== 5000 ||
        payload.channel_quotas[0].output_limit !== 2000
      ) {
        throw new Error('invalid admin entitlement payload')
      }
      adminSaved = true
      data = { plan: { ...payload, id: 102 } }
    } else if (url.pathname === '/api/setup') data = { status: true }
    else if (url.pathname === '/api/notice') data = ''
    else if (url.pathname === '/api/status') {
      data = {
        setup: true,
        system_name: 'new-api',
        version: 'mock',
        start_time: 1,
      }
    } else if (url.pathname === '/api/user/self') data = user
    else if (
      url.pathname === '/api/subscription/plans' ||
      url.pathname === '/api/subscription/admin/plans'
    ) {
      data = [
        {
          plan: url.pathname === '/api/subscription/plans' ? publicPlan : plan,
        },
      ]
    } else if (url.pathname === '/api/subscription/self') {
      data = {
        billing_preference: 'wallet_first',
        subscriptions: purchased ? [publicRecord] : [],
        all_subscriptions: purchased ? [publicRecord] : [],
      }
    } else if (url.pathname === '/api/user/topup/info') {
      data = {
        enable_online_topup: false,
        enable_stripe_topup: false,
        pay_methods: [],
      }
    } else if (url.pathname === '/api/subscription/balance/pay') {
      purchased = true
      data = {}
    } else if (url.pathname === '/api/token/' && method === 'POST') {
      const body = req.postDataJSON()
      if (
        body.user_subscription_id !== 501 ||
        ![7, 8, 9].includes(body.channel_id)
      ) {
        throw new Error('wrong membership key binding')
      }
      if (body.channel_id === 9) {
        if (body.key_type !== 'video' || body.video_model !== 'sora-2-pro') {
          throw new Error('wrong video key type or model')
        }
        videoCreated = true
      } else if (body.channel_id === 8) {
        if (body.key_type !== 'image') throw new Error('wrong image key type')
        imageCreated = true
      } else {
        created = true
      }
      data = { id: 88, ...body, key: 'mock-masked' }
    } else if (url.pathname === '/api/subscription/admin/channels') {
      data = [
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
      ]
    } else if (url.pathname === '/api/option/') {
      data = [
        { key: 'payment_setting.compliance_confirmed', value: 'true' },
        { key: 'payment_setting.compliance_terms_version', value: 'v1' },
      ]
    } else if (url.pathname === '/api/user/groups') data = { default: 1 }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'success', data }),
    })
    return
  }
  if (url.hostname === '127.0.0.1' && url.port === '5188') {
    await route.continue()
    return
  }
  await route.abort()
})
try {
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('CONSOLE', message.text())
  })
  page.on('pageerror', (error) =>
    operations.push({ browserError: error.message })
  )
  await page.goto('http://127.0.0.1:5188/memberships', {
    waitUntil: 'networkidle',
  })

  await page
    .getByRole('heading', { name: 'Membership plans', exact: true })
    .waitFor({ timeout: 5000 })
  const publicCopy = await page.locator('body').innerText()
  if (/Input tokens|Output tokens|1,000,000|200,000/.test(publicCopy))
    {throw new Error('public plan exposes internal token amounts')}
  await page.getByRole('button', { name: 'Subscribe Now', exact: true }).click()
  await page.screenshot({
    path: '/private/tmp/yun-token-membership-checkout.png',
    fullPage: true,
  })

  await page
    .getByRole('button', { name: 'Pay with Balance', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Create membership Key', exact: true })
    .first()
    .waitFor()
  await page.screenshot({
    path: '/private/tmp/yun-token-membership-balances.png',
    fullPage: true,
  })
  await page
    .getByRole('button', { name: 'Create membership Key', exact: true })
    .first()
    .click()
  await page.getByLabel('Name', { exact: true }).fill('Mock membership Key')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page
    .getByText('Membership Key created. Manage it in Keys.', { exact: true })
    .waitFor()
  await page
    .getByRole('button', { name: 'Create membership Key', exact: true })
    .nth(1)
    .click()
  await page
    .getByLabel('Name', { exact: true })
    .fill('Mock image membership Key')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page
    .getByRole('button', { name: 'Create membership Key', exact: true })
    .nth(2)
    .click()
  await page
    .getByLabel('Name', { exact: true })
    .fill('Mock video membership Key')
  await page.getByRole('combobox', { name: 'Model', exact: true }).click()
  await page.getByRole('option', { name: 'sora-2-pro', exact: true }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  if (!purchased || !created || !imageCreated || !videoCreated) {
    throw new Error('mock purchase/key flow incomplete')
  }
  const membershipCopy = await page.locator('body').innerText()
  if (/Input tokens|Output tokens|1,000,000|200,000/.test(membershipCopy))
    {throw new Error('public membership exposes internal token amounts')}
  await page.getByText('Subscription Management', { exact: true }).click()
  await page.getByRole('button', { name: 'Create Plan', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Metering type', exact: true })
    .click()
  await page
    .getByRole('option', { name: 'Channel membership', exact: true })
    .click()
  await page.getByRole('button', { name: 'Add channel', exact: true }).click()
  await page.getByLabel('Plan Title', { exact: true }).fill('Mock admin plan')
  await page.getByLabel('Input tokens', { exact: true }).fill('5000')
  await page.getByLabel('Output tokens', { exact: true }).fill('2000')
  await page.getByRole('button', { name: 'Add channel', exact: true }).click()
  await page.getByLabel('Image count', { exact: true }).fill('10')
  await page.screenshot({
    path: '/private/tmp/yun-token-membership-admin.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  if (!adminSaved) throw new Error('admin plan was not submitted')
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'zh'))
  await page.goto('http://127.0.0.1:5188/memberships', {
    waitUntil: 'networkidle',
  })
  await page.screenshot({
    path: '/private/tmp/yun-token-membership-zh.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: '/private/tmp/yun-token-membership-mobile.png',
    fullPage: true,
  })
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    )
  ) {
    throw new Error('mobile horizontal overflow')
  }
  console.log(
    'MOCK_UI_PASS',
    JSON.stringify({
      purchased,
      created,
      imageCreated,
      videoCreated,
      adminSaved,
      mobileOverflow: false,
      realApiCalls: 0,
    })
  )
  await fs.writeFile(
    '/private/tmp/yun-token-membership-ui-operations.json',
    JSON.stringify(operations, null, 2)
  )
} finally {
  await browser.close()
}
