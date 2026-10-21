import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  discountFactor,
  discountPercent,
  estimateVideoTokens,
  formatAmount,
  parseAmount,
  tokenCost,
  unitCost,
} from './calc'

describe('cost calculator math', () => {
  test('token cost uses per-million pricing scaled by the discount factor', () => {
    assert.equal(tokenCost(2, 1_000_000, 1), 2)
    assert.equal(tokenCost(2, 500_000, 0.85), 0.85)
    assert.equal(tokenCost(0, 999_999, 0.5), 0)
  })

  test('unit cost multiplies price by count and discount factor', () => {
    assert.equal(unitCost(0.25, 4, 0.5), 0.5)
    assert.equal(unitCost(0.25, 4, 1), 1)
  })

  test('discount input is a payable percentage clamped to 0-100', () => {
    assert.equal(discountPercent('85'), 85)
    assert.equal(discountPercent(''), 100)
    assert.equal(discountPercent('120'), 100)
    assert.equal(discountFactor('85'), 0.85)
    assert.equal(discountFactor(''), 1)
  })

  test('invalid or negative drafts count as zero', () => {
    assert.equal(parseAmount(''), 0)
    assert.equal(parseAmount('abc'), 0)
    assert.equal(parseAmount('-5'), 0)
    assert.equal(parseAmount('12.5'), 12.5)
  })

  test('formatAmount keeps up to six decimals with grouping', () => {
    assert.equal(formatAmount(0, '$'), '$0')
    assert.equal(formatAmount(0.0000004, '$'), '$0')
    assert.equal(formatAmount(0.0021, '$'), '$0.0021')
    assert.equal(formatAmount(1234.5, '$'), '$1,234.5')
  })

  test('formatAmount prefixes the configured currency symbol', () => {
    assert.equal(formatAmount(0.0021, '¥'), '¥0.0021')
    assert.equal(formatAmount(1234.5, '€'), '€1,234.5')
  })

  test('video tokens follow per-frame tokens times frame count', () => {
    assert.equal(estimateVideoTokens(1280, 720, 24, 5), 108_900)
    assert.equal(estimateVideoTokens(1920, 1080, 30, 10), 609_525)
  })

  test('video token estimate is zero until all dimensions are set', () => {
    assert.equal(estimateVideoTokens(0, 720, 24, 5), 0)
    assert.equal(estimateVideoTokens(1280, 720, 24, 0), 0)
  })
})
