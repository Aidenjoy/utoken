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

import heroInk1280 from '@/assets/home/hero-ink-1280.webp'
import heroInk2560 from '@/assets/home/hero-ink-2560.webp'
import { Button } from '@/components/ui/button'

interface CTAProps {
  isAuthenticated?: boolean
}

export function CTA(props: CTAProps) {
  const { t } = useTranslation()

  if (props.isAuthenticated) {
    return null
  }

  return (
    <section
      className='home-section home-closing'
      aria-labelledby='home-start-title'
    >
      <div className='home-closing-media' aria-hidden='true'>
        <img
          src={heroInk1280}
          srcSet={`${heroInk1280} 1280w, ${heroInk2560} 2560w`}
          sizes='100vw'
          alt=''
          loading='lazy'
          decoding='async'
        />
      </div>
      <div className='home-closing-overlay' aria-hidden='true' />
      <div className='home-container'>
        <h2 id='home-start-title' className='home-closing-title'>
          {t('Your next idea starts here.')}
        </h2>
        <Button
          className='home-button-primary mt-8 h-12 rounded-full px-8 text-[15px]'
          render={<Link to='/sign-up' />}
        >
          {t('Get API Key')}
        </Button>
      </div>
    </section>
  )
}
