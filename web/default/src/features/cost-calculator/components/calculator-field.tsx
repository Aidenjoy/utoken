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
import { useTranslation } from 'react-i18next'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'

import { NUMERIC_DRAFT_REGEX } from '../lib/calc'

export type CalculatorFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  prefix?: string
  suffix?: string
  description?: string
  placeholder?: string
}

/**
 * Numeric draft input shared by every calculator field: only digits and a
 * single decimal point are accepted, units ride in the input addons.
 */
export function CalculatorField(props: CalculatorFieldProps) {
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      <InputGroup>
        {props.prefix ? (
          <InputGroupAddon>{props.prefix}</InputGroupAddon>
        ) : null}
        <InputGroupInput
          inputMode='decimal'
          placeholder={props.placeholder ?? '0'}
          value={props.value}
          onChange={(event) => {
            const next = event.target.value
            if (NUMERIC_DRAFT_REGEX.test(next)) {
              props.onChange(next)
            }
          }}
        />
        {props.suffix ? (
          <InputGroupAddon align='inline-end'>{props.suffix}</InputGroupAddon>
        ) : null}
      </InputGroup>
      {props.description ? (
        <FieldDescription>{props.description}</FieldDescription>
      ) : null}
    </Field>
  )
}

/** Discount input shared by all three calculators: payable percentage. */
export function DiscountField(props: {
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()

  return (
    <CalculatorField
      label={t('Discount Rate')}
      suffix='%'
      placeholder='100'
      value={props.value}
      onChange={props.onChange}
      description={t(
        'Payable percentage of the list price, e.g. 85 means paying 85% of the price.'
      )}
    />
  )
}
