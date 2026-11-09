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
import type { DocSection, DocsTranslate } from './content'
import { DocText, Note, P } from './doc-typography'

export function buildVideoKeySection(t: DocsTranslate): DocSection {
  return {
    id: 'video-key',
    title: t('Video Model Key'),
    body: (
      <>
        <P>
          {t(
            'Create a video model Key on the General → API Keys page and select a model (one Key per model); check Supports 4K to generate 4K videos.'
          )}
        </P>
        <P>
          <DocText
            text={t(
              'When calling, `model` must match the model bound to the Key; Keys with 4K support enabled must pass `resolution: "4k"`, and Keys without it must not.'
            )}
          />
        </P>
        <P>{t('To use the asset library, also generate AK/SK under this Key.')}</P>
        <Note>
          {t(
            'The model and 4K tier cannot be changed after creation; mismatched requests fail directly — the model is not swapped and the resolution is not downgraded automatically.'
          )}
        </Note>
        <Note>
          {t(
            'Language/image model Keys cannot be used for video generation or asset endpoints; asset endpoints also require a video model Key.'
          )}
        </Note>
      </>
    ),
  }
}
