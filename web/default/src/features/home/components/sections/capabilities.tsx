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

import capDesign from '@/assets/home/cap-design-1280.webp'
import capModel from '@/assets/home/cap-model-1280.webp'
import capModels from '@/assets/home/cap-models-1280.webp'
import capVideo from '@/assets/home/cap-video-1280.webp'

import { Ecosystem } from './ecosystem'

// 四条真实产品线，眉标与标签复用导航/功能已有键，配图各自独立生成。
const lines = [
  {
    eyebrow: 'Video Factory',
    title: 'Script to finished film in one pass',
    desc: 'The engine reads characters, scenes, mood and pacing in your script and cuts a complete long-form video',
    chips: ['Short Drama', 'E-commerce Video', 'Ad Video'],
    img: capVideo,
  },
  {
    eyebrow: 'Model Styling',
    title: 'Try-on without a photoshoot',
    desc: 'Free, multi-item and duo try-on keep fabric, fit and identity consistent across every shot',
    chips: ['Free Try-On', 'Multi-Item Try-On', 'Duo Try-On'],
    img: capModel,
  },
  {
    eyebrow: 'Viral Design',
    title: 'Scroll-stopping campaign visuals',
    desc: 'Fashion and merchandise lines turn a single idea into a full set of on-brand campaign assets',
    chips: ['Fashion Design', 'Merchandise Design', 'Brand kit'],
    img: capDesign,
  },
  {
    eyebrow: 'Model Square',
    title: 'One key, every model',
    desc: 'Dozens of model providers route through one unified API and one bill',
    chips: ['Unified API', 'One bill', 'Auto routing'],
    img: capModels,
  },
]

/**
 * Below-the-fold capability grid. Four product lines, each carrying its own
 * generated still, eyebrow, copy and feature chips, so the dark cinematic
 * world set by the hero keeps its visual weight all the way down the page.
 */
export function Capabilities() {
  const { t } = useTranslation()

  return (
    <section
      className='home-section home-caps'
      aria-labelledby='home-caps-title'
    >
      <div className='home-caps-inner'>
        <div className='home-caps-head'>
          <h2 id='home-caps-title' className='home-heading'>
            {t('An AI engine built for cinematic story worlds')}
          </h2>
          <p className='home-muted home-caps-sub'>
            {t(
              'From script to final cut, multiple engines work together so every creation lands'
            )}
          </p>
        </div>
        <div className='home-caps-grid'>
          {lines.map((line) => (
            <article key={line.eyebrow} className='home-cap-card'>
              <p className='home-cap-eyebrow'>{t(line.eyebrow)}</p>
              <h3 className='home-cap-card-title'>{t(line.title)}</h3>
              <p className='home-cap-card-desc'>{t(line.desc)}</p>
              <ul className='home-cap-chips'>
                {line.chips.map((chip) => (
                  <li key={chip}>{t(chip)}</li>
                ))}
              </ul>
              <div className='home-cap-card-media'>
                <img src={line.img} alt='' loading='lazy' decoding='async' />
              </div>
            </article>
          ))}
        </div>
      </div>
      <Ecosystem />
    </section>
  )
}
