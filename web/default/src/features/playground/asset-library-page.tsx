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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getUserGroups, getUserModels } from './api'
import { AssetLibraryContent } from './components/video/asset-library'

/**
 * Standalone asset library page.
 *
 * Resolves a default group/model pair (first available) so that local file
 * uploads can be routed through the file-upload proxy; the register form
 * itself targets the channel selected inside {@link AssetLibraryContent}.
 */
export function AssetLibraryPage() {
  const { t } = useTranslation()

  const { data: groups } = useQuery({
    queryKey: ['playground-groups'],
    queryFn: getUserGroups,
  })
  const firstGroup = groups?.[0]?.value ?? ''

  const { data: models } = useQuery({
    queryKey: ['playground-models', firstGroup],
    queryFn: () => getUserModels(firstGroup),
    enabled: firstGroup !== '',
  })

  return (
    <div className='flex h-full flex-col gap-4 overflow-hidden p-4 md:p-6'>
      <header className='shrink-0 space-y-1'>
        <h1 className='text-xl font-semibold tracking-tight'>
          {t('Asset Library')}
        </h1>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Register portrait assets by URL, then reference them with @ in the prompt'
          )}
        </p>
      </header>
      <AssetLibraryContent
        model={models?.[0]?.value ?? ''}
        group={firstGroup}
        className='min-h-0 flex-1'
      />
    </div>
  )
}
