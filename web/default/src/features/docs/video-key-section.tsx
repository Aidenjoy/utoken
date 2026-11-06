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
import type { DocSection } from './content'
import { InlineCode, Note, P } from './doc-typography'

export const videoKeySection: DocSection = {
  id: 'video-key',
  title: '视频模型 Key',
  body: (
    <>
      <P>
        在「常规 → API 密钥」页面点击「创建视频模型
        Key」，输入名称并选择模型；需要生成 4K 视频时，同时勾选「支持
        4K」。每个视频模型 Key 仅绑定创建时选择的一个模型。
      </P>
      <P>
        调用视频生成接口时，请求中的 <InlineCode>model</InlineCode> 必须与 Key
        创建时选择的模型完全一致。未勾选「支持 4K」的 Key 不能传{' '}
        <InlineCode>resolution: &quot;4k&quot;</InlineCode>；勾选「支持 4K」的
        Key 则必须在每次视频生成请求中显式传入该参数。
      </P>
      <Note>
        模型或 4K 档位不符合 Key
        配置时，请求会直接返回错误，不会自动更换模型或降低分辨率。 模型与 4K
        档位创建后不可修改；如需使用其他配置，请创建新的视频模型 Key。
      </Note>
      <Note>
        语言模型 Key 和图片模型 Key
        不能用于视频生成或视频素材接口。上传视频素材、创建素材组及调用相关素材接口时，请同样使用视频模型
        Key。
      </Note>
    </>
  ),
}
