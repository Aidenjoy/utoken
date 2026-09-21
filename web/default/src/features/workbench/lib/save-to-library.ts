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
import { toast } from 'sonner'

import {
  createDirectorAsset,
  uploadDirectorAsset,
} from '@/features/director/api'

/** Business scene a workbench page archives into (shared asset library tab). */
export type WorkbenchScene = 'try-on' | 'viral-hero' | 'viral-design'

type Translate = (key: string, options?: Record<string, unknown>) => string

// data URL -> File so it can travel through the multipart upload endpoint and
// be rehosted on TOS, giving the library a durable same-origin address.
async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], filename, { type: blob.type || 'image/png' })
}

/**
 * Archive a finished generation into the shared asset library so both the
 * uploaded sources and the generated results are reusable from /director/assets,
 * mirroring how the video factory persists its own output. Best-effort: every
 * image is saved independently and a failure never breaks the generation flow.
 */
export async function saveGenerationToLibrary(
  scene: WorkbenchScene,
  name: string,
  results: string[],
  sources: string[],
  t: Translate
): Promise<void> {
  let saved = 0
  let failed = 0

  for (const [index, src] of results.entries()) {
    if (!src) continue
    try {
      // Remote URLs are registered as-is (same as the video factory); inline
      // base64 results are uploaded to TOS so the library link stays stable.
      const res = src.startsWith('data:')
        ? await uploadDirectorAsset({
            file: await dataUrlToFile(src, `${name}-${index + 1}.png`),
            scene,
            category: 'generated',
          })
        : await createDirectorAsset({
            url: src,
            scene,
            type: 'image',
            category: 'generated',
            name,
          })
      if (res.success) saved++
      else failed++
    } catch {
      failed++
    }
  }

  for (const [index, src] of sources.entries()) {
    if (!src) continue
    try {
      const res = src.startsWith('data:')
        ? await uploadDirectorAsset({
            file: await dataUrlToFile(src, `${name}-${index + 1}.png`),
            scene,
            category: 'upload',
          })
        : await createDirectorAsset({
            url: src,
            scene,
            type: 'image',
            category: 'upload',
            name,
          })
      if (res.success) saved++
      else failed++
    } catch {
      failed++
    }
  }

  if (saved > 0) {
    toast.success(
      t('Saved {{count}} images to the asset library', { count: saved })
    )
  }
  if (failed > 0) {
    toast.error(t('Operation failed'))
  }
}
