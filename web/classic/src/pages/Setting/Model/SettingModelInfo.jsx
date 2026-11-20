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
import { Button, Col, Input, Row, Spin, Typography } from '@douyinfe/semi-ui';
import { API, showError, showSuccess, showWarning } from '../../../helpers';
import { useTranslation } from 'react-i18next';

const { Text, Paragraph } = Typography;

// 与后端存储契约一致：整数 token。UI 接受 K/M 简写（K=1024，M=1024²）。
function parseTokenInput(raw) {
  const value = (raw || '').trim();
  if (!value) return 0;
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(value);
  if (!match) return null;
  const suffix = (match[2] || '').toLowerCase();
  const multiplier = suffix === 'm' ? 1024 * 1024 : suffix === 'k' ? 1024 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function formatTokenValue(value) {
  if (!value) return '';
  if (value % (1024 * 1024) === 0) return `${value / (1024 * 1024)}M`;
  if (value % 1024 === 0) return `${value / 1024}K`;
  return String(value);
}

export default function SettingModelInfo() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [languageModels, setLanguageModels] = useState([]);
  const [rows, setRows] = useState({});
  const [savedRows, setSavedRows] = useState({});
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await API.get('/api/model_info');
        if (cancelled) return;
        const { success, message, data } = res.data;
        if (!success) {
          showError(message);
          return;
        }
        const models = data?.language_models || [];
        const infos = data?.infos || [];
        const infoMap = new Map(infos.map((info) => [info.model_name, info]));
        const next = {};
        for (const name of models) {
          const info = infoMap.get(name);
          next[name] = {
            context: formatTokenValue(info?.context_window || 0),
            maxOutput: formatTokenValue(info?.max_output_tokens || 0),
          };
        }
        setLanguageModels(models);
        setRows(next);
        setSavedRows(next);
      } catch (error) {
        if (!cancelled) showError(t('加载失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = JSON.stringify(rows) !== JSON.stringify(savedRows);
  const trimmedKeyword = keyword.trim().toLowerCase();
  const filteredModels = trimmedKeyword
    ? languageModels.filter((name) => name.toLowerCase().includes(trimmedKeyword))
    : languageModels;

  function updateRow(name, field, value) {
    setRows((prev) => ({ ...prev, [name]: { ...prev[name], [field]: value } }));
  }

  async function handleSave() {
    if (!dirty) {
      showWarning(t('你似乎并没有修改什么'));
      return;
    }
    const infos = [];
    for (const name of languageModels) {
      const row = rows[name] || { context: '', maxOutput: '' };
      const context = parseTokenInput(row.context);
      const maxOutput = parseTokenInput(row.maxOutput);
      if (context === null || maxOutput === null) {
        showError(t('{{model}} 的 token 数格式无效', { model: name }));
        return;
      }
      infos.push({
        model_name: name,
        context_window: context,
        max_output_tokens: maxOutput,
      });
    }
    setSaving(true);
    try {
      const res = await API.put('/api/model_info', { infos });
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('保存成功'));
        setSavedRows(rows);
      } else {
        showError(message);
      }
    } catch (error) {
      showError(t('保存失败，请重试'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Spin spinning={loading}>
      <Text strong style={{ fontSize: 16 }}>
        {t('模型信息')}
      </Text>
      <Paragraph type='tertiary' style={{ marginTop: 4, marginBottom: 4 }}>
        {t(
          '为语言模型配置上下文窗口与最大输出 token 数，配置后的值将通过 /v1/modelsinfo 接口返回。'
        )}
      </Paragraph>
      <Paragraph type='tertiary' style={{ marginTop: 0 }}>
        {t(
          '可填整数或 128K / 1M 形式的值（K = 1024，M = 1048576），留空表示清除配置。'
        )}
      </Paragraph>
      <Input
        value={keyword}
        onChange={setKeyword}
        placeholder={t('搜索模型')}
        style={{ maxWidth: 320, marginBottom: 12 }}
        showClear
      />
      {filteredModels.length === 0 ? (
        <Paragraph type='tertiary'>{t('暂无模型')}</Paragraph>
      ) : (
        filteredModels.map((name) => (
          <div key={name} style={{ marginBottom: 12 }}>
            <Text strong style={{ fontFamily: 'monospace' }}>
              {name}
            </Text>
            <Row gutter={12} style={{ marginTop: 4 }}>
              <Col xs={12} md={8}>
                <Text type='tertiary' size='small'>
                  {t('上下文窗口')}
                </Text>
                <Input
                  value={rows[name]?.context || ''}
                  onChange={(value) => updateRow(name, 'context', value)}
                  placeholder='1M'
                  aria-label={`${name} - ${t('上下文窗口')}`}
                  disabled={saving}
                />
              </Col>
              <Col xs={12} md={8}>
                <Text type='tertiary' size='small'>
                  {t('最大输出 token 数')}
                </Text>
                <Input
                  value={rows[name]?.maxOutput || ''}
                  onChange={(value) => updateRow(name, 'maxOutput', value)}
                  placeholder='128K'
                  aria-label={`${name} - ${t('最大输出 token 数')}`}
                  disabled={saving}
                />
              </Col>
            </Row>
          </div>
        ))
      )}
      <Button onClick={handleSave} loading={saving} disabled={!dirty}>
        {t('保存')}
      </Button>
    </Spin>
  );
}