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

/**
 * Round a token rate UP to 2 decimals (ceiling) so the billed multiplier is
 * never truncated below the intended ratio, which would under-charge. A tiny
 * epsilon first snaps floating-point noise (e.g. 0.07 * 100 = 7.000000000000001)
 * to the nearest integer, so values that are already 2 decimals are not bumped
 * up. Mirrors the backend `ceilTokenRate` so the dialog preview matches the
 * stored rate exactly.
 */
export function ceilTokenRate(rate: number): number {
  const scaled = rate * 100
  const rounded = Math.round(scaled)
  const snapped = Math.abs(scaled - rounded) < 1e-9 ? rounded : scaled
  return Math.ceil(snapped) / 100
}
