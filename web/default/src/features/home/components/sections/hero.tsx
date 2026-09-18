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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import heroAnimation1280 from '@/assets/home/hero-animation-1280.webp'
import heroAnimation2560 from '@/assets/home/hero-animation-2560.webp'
import heroCoastline1280 from '@/assets/home/hero-coastline-1280.webp'
import heroCoastline2560 from '@/assets/home/hero-coastline-2560.webp'
import heroInk1280 from '@/assets/home/hero-ink-1280.webp'
import heroInk2560 from '@/assets/home/hero-ink-2560.webp'
import heroNeonCity1280 from '@/assets/home/hero-neon-city-1280.webp'
import heroNeonCity2560 from '@/assets/home/hero-neon-city-2560.webp'
import heroSpace1280 from '@/assets/home/hero-space-1280.webp'
import heroSpace2560 from '@/assets/home/hero-space-2560.webp'
import { Button } from '@/components/ui/button'

interface HeroProps {
  isAuthenticated?: boolean
}

// 轮播画面对应平台可生成的多种视频风格，仅作氛围背景。
// 1280w 供移动端等小屏，2560w 供桌面大屏，浏览器按 srcset 自动选择。
const heroFrames = [
  { w1280: heroNeonCity1280, w2560: heroNeonCity2560 },
  { w1280: heroCoastline1280, w2560: heroCoastline2560 },
  { w1280: heroSpace1280, w2560: heroSpace2560 },
  { w1280: heroAnimation1280, w2560: heroAnimation2560 },
  { w1280: heroInk1280, w2560: heroInk2560 },
]

export function Hero(props: HeroProps) {
  const { t } = useTranslation()

  return (
    <section className='home-hero' aria-labelledby='home-title'>
      <div className='home-hero-media' aria-hidden='true'>
        {heroFrames.map((frame, index) => (
          <img
            key={frame.w2560}
            src={frame.w1280}
            srcSet={`${frame.w1280} 1280w, ${frame.w2560} 2560w`}
            sizes='100vw'
            alt=''
            decoding='async'
            fetchPriority={index === 0 ? 'high' : 'auto'}
          />
        ))}
      </div>
      <div className='home-hero-overlay' aria-hidden='true' />
      <div className='home-hero-content home-container'>
        <h1 id='home-title' className='home-title'>
          <span className='home-title-line'>
            {t('Create infinite possibilities')}
          </span>
          <span className='home-title-line home-title-gradient'>
            {t('Create like a Hollywood director')}
          </span>
        </h1>
        <p className='home-sub'>
          {t(
            'One-stop AI creation — cinematic workflow, e-commerce model styling, and viral design in one place'
          )}
        </p>
        <div className='home-actions'>
          <Button
            className='home-button-primary h-12 rounded-full px-7 text-[15px]'
            render={
              <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
            }
          >
            {props.isAuthenticated ? t('Start exploring') : t('Get API Key')}
          </Button>
        </div>
      </div>
    </section>
  )
}
