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

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { ImageModelCalculator } from './components/image-model-calculator'
import { LanguageModelCalculator } from './components/language-model-calculator'
import { VideoModelCalculator } from './components/video-model-calculator'

/**
 * Offline cost estimator: every input lives in component state only, nothing
 * is persisted or sent to the backend.
 */
export function CostCalculator() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Cost Calculator')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-6'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Estimate language, image, and video generation costs from list prices. Inputs are kept in memory only and never saved.'
            )}
          </p>
          <Tabs defaultValue='language' className='gap-4'>
            <TabsList>
              <TabsTrigger value='language'>
                {t('Language Model')}
              </TabsTrigger>
              <TabsTrigger value='image'>{t('Image Model')}</TabsTrigger>
              <TabsTrigger value='video'>
                {t('Video Generation Model')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value='language'>
              <LanguageModelCalculator />
            </TabsContent>
            <TabsContent value='image'>
              <ImageModelCalculator />
            </TabsContent>
            <TabsContent value='video'>
              <VideoModelCalculator />
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
