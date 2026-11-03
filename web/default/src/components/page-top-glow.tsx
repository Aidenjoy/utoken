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
 * Shared top-of-page background glow used by public pages (docs, prices).
 * Keep a single definition so every page shows the same backdrop.
 */
export function PageTopGlow() {
  return (
    <div
      aria-hidden
      className='pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-20 dark:opacity-[0.10]'
      style={{
        background: [
          'radial-gradient(ellipse 55% 45% at 15% 20%, oklch(0.72 0.14 160 / 70%) 0%, transparent 70%)',
          'radial-gradient(ellipse 50% 40% at 85% 15%, oklch(0.65 0.15 250 / 60%) 0%, transparent 70%)',
          'radial-gradient(ellipse 40% 35% at 50% 60%, oklch(0.70 0.12 200 / 40%) 0%, transparent 70%)',
        ].join(', '),
        maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, black 40%, transparent 100%)',
      }}
    />
  )
}
