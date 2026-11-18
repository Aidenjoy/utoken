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
import fs from 'node:fs/promises'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')
function stableStringify(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`
}
const newKeys = {
  en: {
    'Add channel': 'Add channel',
    'Channel membership': 'Channel membership',
    'Channel membership never falls back to wallet balance.':
      'Channel membership never falls back to wallet balance.',
    'Channel {{id}}': 'Channel {{id}}',
    'Create membership Key': 'Create membership Key',
    'Failed to load channels': 'Failed to load channels',
    'Failed to load memberships': 'Failed to load memberships',
    'Input / output tokens': 'Input / output tokens',
    Keys: 'Keys',
    Limit: 'Limit',
    'Membership Key created. Manage it in Keys.':
      'Membership Key created. Manage it in Keys.',
    'Membership plans': 'Membership plans',
    'Metering type': 'Metering type',
    'My channel balances': 'My channel balances',
    'No channel membership plans available':
      'No channel membership plans available',
    'No channel memberships yet': 'No channel memberships yet',
    'Remove channel from plan': 'Remove channel from plan',
    Reserved: 'Reserved',
    'Select a channel': 'Select a channel',
    'Wallet quota': 'Wallet quota',
  },
  zh: {
    'Add channel': '添加渠道',
    'Channel membership': '渠道会员',
    'Channel membership never falls back to wallet balance.':
      '渠道会员仅使用绑定额度，不会回退扣钱包。',
    'Channel {{id}}': '渠道 {{id}}',
    'Create membership Key': '创建会员 Key',
    'Failed to load channels': '加载渠道失败',
    'Failed to load memberships': '加载会员信息失败',
    'Input / output tokens': '输入 / 输出 Token',
    Keys: '密钥',
    Limit: '上限',
    'Membership Key created. Manage it in Keys.':
      '会员 Key 已创建，请到密钥管理中查看。',
    'Membership plans': '会员套餐',
    'Metering type': '计量类型',
    'My channel balances': '我的渠道余额',
    'No channel membership plans available': '暂无可购买的渠道会员套餐',
    'No channel memberships yet': '暂无渠道会员订阅',
    'Remove channel from plan': '从套餐配置中移除此渠道',
    Reserved: '预留',
    'Select a channel': '选择渠道',
    'Wallet quota': '钱包计费额度',
  },
  fr: {
    'Add channel': 'Ajouter un canal',
    'Channel membership': 'Abonnement par canal',
    'Channel membership never falls back to wallet balance.':
      'Cet abonnement utilise uniquement le quota du canal, sans débiter le portefeuille.',
    'Channel {{id}}': 'Canal {{id}}',
    'Create membership Key': 'Créer une clé membre',
    'Failed to load channels': 'Échec du chargement des canaux',
    'Failed to load memberships': 'Échec du chargement des abonnements',
    'Input / output tokens': 'Tokens entrants / sortants',
    Keys: 'Clés',
    Limit: 'Plafond',
    'Membership Key created. Manage it in Keys.':
      'Clé membre créée. Gérez-la dans les clés.',
    'Membership plans': 'Offres membres',
    'Metering type': 'Type de mesure',
    'My channel balances': 'Mes quotas par canal',
    'No channel membership plans available':
      'Aucune offre par canal disponible',
    'No channel memberships yet': 'Aucun abonnement par canal',
    'Remove channel from plan': 'Retirer ce canal de l’offre',
    Reserved: 'Réservé',
    'Select a channel': 'Choisir un canal',
    'Wallet quota': 'Quota du portefeuille',
  },
  ja: {
    'Add channel': 'チャネルを追加',
    'Channel membership': 'チャネル会員',
    'Channel membership never falls back to wallet balance.':
      'チャネル会員は紐付けられた枠のみを使用し、ウォレットには課金しません。',
    'Channel {{id}}': 'チャネル {{id}}',
    'Create membership Key': '会員キーを作成',
    'Failed to load channels': 'チャネルの読み込みに失敗しました',
    'Failed to load memberships': '会員情報の読み込みに失敗しました',
    'Input / output tokens': '入力 / 出力トークン',
    Keys: 'キー',
    Limit: '上限',
    'Membership Key created. Manage it in Keys.':
      '会員キーを作成しました。キー管理で確認できます。',
    'Membership plans': '会員プラン',
    'Metering type': '計量タイプ',
    'My channel balances': 'チャネル別残量',
    'No channel membership plans available':
      '購入できるチャネル会員プランはありません',
    'No channel memberships yet': 'チャネル会員の契約はありません',
    'Remove channel from plan': 'プラン設定からチャネルを外す',
    Reserved: '予約済み',
    'Select a channel': 'チャネルを選択',
    'Wallet quota': 'ウォレット課金枠',
  },
  ru: {
    'Add channel': 'Добавить канал',
    'Channel membership': 'Подписка по каналам',
    'Channel membership never falls back to wallet balance.':
      'Подписка использует только привязанную квоту, без списаний с кошелька.',
    'Channel {{id}}': 'Канал {{id}}',
    'Create membership Key': 'Создать ключ подписки',
    'Failed to load channels': 'Не удалось загрузить каналы',
    'Failed to load memberships': 'Не удалось загрузить подписки',
    'Input / output tokens': 'Входные / выходные токены',
    Keys: 'Ключи',
    Limit: 'Лимит',
    'Membership Key created. Manage it in Keys.':
      'Ключ подписки создан. Откройте управление ключами.',
    'Membership plans': 'Тарифы подписки',
    'Metering type': 'Тип учёта',
    'My channel balances': 'Мои квоты по каналам',
    'No channel membership plans available': 'Нет доступных тарифов по каналам',
    'No channel memberships yet': 'Подписок по каналам пока нет',
    'Remove channel from plan': 'Убрать канал из тарифа',
    Reserved: 'Зарезервировано',
    'Select a channel': 'Выберите канал',
    'Wallet quota': 'Квота кошелька',
  },
  vi: {
    'Add channel': 'Thêm kênh',
    'Channel membership': 'Gói thành viên theo kênh',
    'Channel membership never falls back to wallet balance.':
      'Gói thành viên chỉ dùng hạn mức đã liên kết, không trừ ví.',
    'Channel {{id}}': 'Kênh {{id}}',
    'Create membership Key': 'Tạo Key thành viên',
    'Failed to load channels': 'Không tải được kênh',
    'Failed to load memberships': 'Không tải được thông tin thành viên',
    'Input / output tokens': 'Token đầu vào / đầu ra',
    Keys: 'Khóa',
    Limit: 'Giới hạn',
    'Membership Key created. Manage it in Keys.':
      'Đã tạo Key thành viên. Xem tại mục quản lý khóa.',
    'Membership plans': 'Gói thành viên',
    'Metering type': 'Kiểu đo lường',
    'My channel balances': 'Hạn mức kênh của tôi',
    'No channel membership plans available': 'Chưa có gói thành viên theo kênh',
    'No channel memberships yet': 'Chưa có gói thành viên theo kênh',
    'Remove channel from plan': 'Bỏ kênh khỏi cấu hình gói',
    Reserved: 'Đã giữ chỗ',
    'Select a channel': 'Chọn kênh',
    'Wallet quota': 'Hạn mức ví',
  },
}

newKeys.en['Image count'] = 'Image count'
newKeys.zh['Image count'] = '图片张数'
newKeys.fr['Image count'] = 'Nombre d’images'
newKeys.ja['Image count'] = '画像枚数'
newKeys.ru['Image count'] = 'Количество изображений'
newKeys.vi['Image count'] = 'Số lượng ảnh'
newKeys.en['Completed videos'] = 'Completed videos'
newKeys.zh['Completed videos'] = '成功生成视频次数'
newKeys.fr['Completed videos'] = 'Vidéos terminées'
newKeys.ja['Completed videos'] = '生成完了した動画数'
newKeys.ru['Completed videos'] = 'Готовые видео'
newKeys.vi['Completed videos'] = 'Số video tạo thành công'
Object.assign(newKeys.en, {
  'My memberships': 'My memberships',
  'Membership benefits': 'Membership benefits',
  'Plan allowance exhausted': 'Plan allowance exhausted',
})
Object.assign(newKeys.zh, {
  'My memberships': '我的会员',
  'Membership benefits': '会员权益',
  'Plan allowance exhausted': '套餐额度不足',
})
Object.assign(newKeys.fr, {
  'My memberships': 'Mes abonnements',
  'Membership benefits': 'Avantages inclus',
  'Plan allowance exhausted': 'Quota du forfait épuisé',
})
Object.assign(newKeys.ja, {
  'My memberships': '加入中のプラン',
  'Membership benefits': '会員特典',
  'Plan allowance exhausted': 'プランの利用枠が不足しています',
})
Object.assign(newKeys.ru, {
  'My memberships': 'Мои подписки',
  'Membership benefits': 'Возможности подписки',
  'Plan allowance exhausted': 'Лимит подписки исчерпан',
})
Object.assign(newKeys.vi, {
  'My memberships': 'Gói thành viên của tôi',
  'Membership benefits': 'Quyền lợi thành viên',
  'Plan allowance exhausted': 'Đã hết hạn mức gói',
})
Object.assign(newKeys.en, {
  'Audio duration (ms)': 'Audio duration (ms)',
  'Input characters': 'Input characters',
})
Object.assign(newKeys.zh, {
  'Audio duration (ms)': '音频时长（毫秒）',
  'Input characters': '输入字符数',
})
Object.assign(newKeys.fr, {
  'Audio duration (ms)': 'Durée audio (ms)',
  'Input characters': 'Caractères en entrée',
})
Object.assign(newKeys.ja, {
  'Audio duration (ms)': '音声時間（ミリ秒）',
  'Input characters': '入力文字数',
})
Object.assign(newKeys.ru, {
  'Audio duration (ms)': 'Длительность аудио (мс)',
  'Input characters': 'Входные символы',
})
Object.assign(newKeys.vi, {
  'Audio duration (ms)': 'Thời lượng âm thanh (ms)',
  'Input characters': 'Số ký tự đầu vào',
})
async function main() {
  for (const [locale, trans] of Object.entries(newKeys)) {
    const filePath = path.join(LOCALES_DIR, `${locale}.json`)
    const json = JSON.parse(await fs.readFile(filePath, 'utf8'))
    for (const [key, value] of Object.entries(trans)) {
      json.translation[key] = value
    }
    json.translation = Object.fromEntries(
      Object.entries(json.translation).sort(([a], [b]) => a.localeCompare(b))
    )
    await fs.writeFile(filePath, stableStringify(json), 'utf8')
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
