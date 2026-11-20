/*
Copyright (C) 2025 QuantumNous

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
import React, { useEffect, useState } from 'react';
import {
  Button,
  Table,
  Select,
  Tabs,
  TabPane,
  Space,
  Typography,
  Banner,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import {
  API,
  renderSubscriptionPoints,
  renderSubscriptionPlanPrice,
  renderQuota,
  showError,
} from '../../../helpers';

const { Text } = Typography;
const emptyFilter = {
  user: '',
  plan: '',
  subscription: '',
  status: '',
  start: '',
  end: '',
};

/** Read-only subscription points ledger; orders and point consumption never update balances here. */
export default function SubscriptionBilling() {
  const { t } = useTranslation();
  const [kind, setKind] = useState('usage');
  const [draft, setDraft] = useState(emptyFilter);
  const [filter, setFilter] = useState(emptyFilter);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [stat, setStat] = useState({});
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const params = {
    kind,
    user_ids: filter.user || undefined,
    plan_id: filter.plan || undefined,
    subscription_id:
      kind === 'orders' ? undefined : filter.subscription || undefined,
    status: kind === 'usage' ? undefined : filter.status || undefined,
    start_timestamp: filter.start
      ? Math.floor(new Date(`${filter.start}T00:00:00`).getTime() / 1000)
      : undefined,
    end_timestamp: filter.end
      ? Math.floor(new Date(`${filter.end}T23:59:59`).getTime() / 1000)
      : undefined,
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setRows([]);
    setTotal(0);
    setStat({});
    API.get('/api/subscription/admin/billing', {
      params: { ...params, p: page, page_size: 20 },
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!data.success) throw new Error(data.message);
        setRows(data.data.items);
        setTotal(data.data.total);
        setStat(data.data.stat);
      })
      .catch((error) => {
        if (!controller.signal.aborted) showError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, filter, page, refreshVersion]);
  const columns = [
    { title: t('ID'), dataIndex: 'id', render: (v) => `#${v}` },
    {
      title: t('Time'),
      dataIndex: 'created_at',
      render: (v) => (v ? new Date(v * 1000).toLocaleString() : '—'),
    },
    {
      title: t('User'),
      dataIndex: 'username',
      render: (v, row) => `${v || '—'} (#${row.user_id})`,
    },
    {
      title: t('Subscription Plan'),
      dataIndex: 'plan_title',
      render: (v, row) =>
        v ||
        (row.plan_id
          ? `#${row.plan_id}`
          : t('Historical information unavailable')),
    },
  ];
  if (kind !== 'orders')
    columns.push({
      title: t('Subscription ID'),
      dataIndex: 'subscription_id',
      render: (v) => v || '—',
    });
  if (kind !== 'orders') {
    columns.push(
      {
        title: t('点数比例'),
        dataIndex: 'points_ratio',
        render: (v) => v ?? '—',
      },
      {
        title: t('预计毛利润（%）'),
        dataIndex: 'gross_profit_percent',
        render: (v) => (v == null ? '—' : `${v}%`),
      },
    );
  }
  if (kind === 'instances')
    columns.push(
      { title: t('Status'), dataIndex: 'status', render: (v) => t(v) },
      { title: t('Source'), dataIndex: 'source', render: (v) => t(v) },
      {
        title: t('Total Points'),
        dataIndex: 'total',
        render: (v, row) =>
          row.unlimited ? t('Unlimited') : renderSubscriptionPoints(v),
      },
      {
        title: t('Used Points'),
        dataIndex: 'used',
        render: (v) => renderSubscriptionPoints(v),
      },
      {
        title: t('Remaining Points'),
        dataIndex: 'remaining',
        render: (v, row) =>
          row.unlimited ? t('Unlimited') : renderSubscriptionPoints(v),
      },
      {
        title: t('Expiration Time'),
        dataIndex: 'end_time',
        render: (v) => (v ? new Date(v * 1000).toLocaleString() : '—'),
      },
    );
  if (kind === 'usage')
    columns.push(
      { title: t('Model'), dataIndex: 'model_name' },
      {
        title: t('Type'),
        dataIndex: 'type',
        render: (v) => (v === 6 ? t('Refund') : t('Consume')),
      },
      {
        title: t('Subscription Points'),
        dataIndex: 'points',
        render: (v) => renderSubscriptionPoints(v),
      },
      {
        title: t('Subscription Base Charge'),
        dataIndex: 'base_quota',
        render: (v) => (v == null ? '—' : renderQuota(v, 6)),
      },
      { title: t('Request ID'), dataIndex: 'request_id' },
    );
  if (kind === 'orders')
    columns.push(
      { title: t('Status'), dataIndex: 'status', render: (v) => t(v) },
      {
        title: t('Order Amount'),
        dataIndex: 'money',
        render: (v) => renderSubscriptionPlanPrice(v),
      },
      { title: t('Payment Method'), dataIndex: 'payment_method' },
      { title: t('Order Number'), dataIndex: 'trade_no' },
    );
  const exportRecords = async () => {
    setExporting(true);
    try {
      const res = await API.get('/api/subscription/admin/billing', {
        params: { ...params, export: 'csv' },
        responseType: 'blob',
      });
      if (res.data.type.includes('json')) {
        const error = JSON.parse(await res.data.text());
        throw new Error(error.message || t('Export failed'));
      }
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `subscription-${kind}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showError(error.message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className='space-y-4 mt-4'>
      <Banner
        type='info'
        closeIcon={null}
        description={t(
          'Point spending does not change wallet balances or monetary usage. Historical missing data cannot be reconstructed.',
        )}
      />
      <Space wrap>
        <Tabs
          activeKey={kind}
          onChange={(value) => {
            setKind(value);
            setDraft({ ...draft, status: '' });
            setFilter({ ...filter, status: '' });
            setPage(1);
          }}
        >
          <TabPane tab={t('Point Usage Details')} itemKey='usage' />
          <TabPane tab={t('Plan Points')} itemKey='instances' />
          <TabPane tab={t('Purchase Records')} itemKey='orders' />
        </Tabs>
        {[
          ['user', 'User ID'],
          ['plan', 'Plan ID'],
          ...(kind === 'orders' ? [] : [['subscription', 'Subscription ID']]),
        ].map(([key, label]) => (
          <input
            key={key}
            type='number'
            min='1'
            className='border rounded px-2 py-1 w-32 bg-transparent'
            aria-label={t(label)}
            placeholder={t(label)}
            value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          />
        ))}
        {kind !== 'usage' && (
          <Select
            aria-label={t('Status')}
            value={draft.status}
            onChange={(status) => setDraft({ ...draft, status })}
            optionList={[
              { value: '', label: t('All Status') },
              ...(kind === 'instances'
                ? ['active', 'expired', 'cancelled']
                : ['pending', 'success', 'expired', 'failed']
              ).map((status) => ({ value: status, label: t(status) })),
            ]}
          />
        )}
        <input
          className='border rounded px-2 py-1 bg-transparent'
          type='date'
          aria-label={t('Start Date')}
          value={draft.start}
          onChange={(e) => setDraft({ ...draft, start: e.target.value })}
        />
        <input
          className='border rounded px-2 py-1 bg-transparent'
          type='date'
          aria-label={t('End Date')}
          value={draft.end}
          onChange={(e) => setDraft({ ...draft, end: e.target.value })}
        />
        <Button
          onClick={() => {
            setFilter(draft);
            setPage(1);
          }}
        >
          {t('Search')}
        </Button>
        <Button onClick={exportRecords} disabled={exporting || !total}>
          {t('Export CSV')}
        </Button>
      </Space>
      <Button
        disabled={loading}
        onClick={() => setRefreshVersion((v) => v + 1)}
      >
        {t('刷新')}
      </Button>
      {kind === 'instances' && stat.unlimited_count > 0 && (
        <Text>
          {t('Unlimited plans are excluded from the remaining points total.')}
        </Text>
      )}
      <div className='flex flex-wrap gap-6'>
        {kind === 'usage' ? (
          <>
            <Text>
              {t('Requests')}: {stat.request_count || 0}
            </Text>
            <Text>
              {t('Consumed')}: {renderSubscriptionPoints(stat.consumed || 0)}
            </Text>
            <Text>
              {t('Refunded')}: {renderSubscriptionPoints(stat.refunded || 0)}
            </Text>
            <Text>
              {t('Actual Consumption')}:{' '}
              {renderSubscriptionPoints(
                (stat.consumed || 0) - (stat.refunded || 0),
              )}
            </Text>
          </>
        ) : (
          <Text>
            {kind === 'orders'
              ? t('Paid Amount')
              : t('Current Active Remaining Points')}
            :{' '}
            {kind === 'orders'
              ? renderSubscriptionPlanPrice(stat.paid_money || 0)
              : renderSubscriptionPoints(stat.current_remaining || 0)}
          </Text>
        )}
      </div>
      <Table
        columns={columns}
        dataSource={rows}
        rowKey='id'
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{
          currentPage: page,
          pageSize: 20,
          total,
          onPageChange: setPage,
        }}
      />
    </div>
  );
}
