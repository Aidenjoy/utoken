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
import { CodeBlock } from './code-block'
import type { DocSection, DocsTranslate } from './content'
import { DocText, Note, P } from './doc-typography'

const WAN_MODEL = 'wan3.0-video'

const wanSubmitResponse = `{
  "output": {
    "task_id": "a8532587-fa8c-4ef8-82be-0c46b17950d1",
    "task_status": "PENDING"
  },
  "request_id": "7574ee8f-38a3-4b1e-9280-11c33ab46e51"
}`

export function buildWanVideoSections(
  siteUrl: string,
  t: DocsTranslate
): DocSection[] {
  const submitUrl = `${siteUrl}/api/v1/services/aigc/video-generation/video-synthesis`
  const tasksUrl = `${siteUrl}/api/v1/tasks`
  return [
    {
      id: 'wan-overview',
      title: t('Integration Overview'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'This endpoint is fully compatible with the official Alibaba Cloud DashScope video generation API: replace the base_url with this site and use your token from this site as the API key — request paths, request bodies and response formats stay identical to the official API.'
              )}
            />
          </P>
          <P>
            <DocText
              text={t(
                'Four creation modes are supported: reference-based generation, text-to-video, first & last frame, and first frame; a successful submission returns a task ID for later status queries.'
              )}
            />
          </P>
          <Note>
            <DocText
              text={t(
                'Video generation endpoints require a video model Key: create one on the General → API Keys page and select the wan model (one Key per model). The `model` in requests must match the model bound to the Key.'
              )}
            />
          </Note>
        </>
      ),
    },
    {
      id: 'wan-submit',
      title: t('Submit Video Generation Task'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Creates an asynchronous video generation task. `input.prompt` describes the video; `input.media` carries image, video and audio inputs for the image-to-video and reference-based modes. `parameters.resolution` selects the resolution tier (`480P` / `720P` / `1080P`), `parameters.ratio` the aspect ratio (`adaptive` follows the input media), and `parameters.duration` the video length in seconds (`2`-`30`, or `-1` to let the model decide automatically).'
              )}
            />
          </P>
        </>
      ),
      children: [
        {
          id: 'wan-reference',
          title: t('Reference-based Generation'),
          body: (
            <>
              <P>
                <DocText
                  text={t(
                    'Reference-based generation combines the prompt with reference images (up to 10), reference videos (up to 5, total duration within 15 seconds) and reference audio (up to 5, total duration within 15 seconds) via `input.media`. In the prompt, refer to the media in array order as image 1, video 1, audio 1, etc.'
                  )}
                />
              </P>
              <CodeBlock
                method='POST'
                url={submitUrl}
                lang='json'
                code={`{
  "model": "${WAN_MODEL}",
  "input": {
    "prompt": "${t('The subject from image 1 follows the motion of video 1, with audio 1 as the background rhythm')}",
    "media": [
      {"type": "reference_image", "url": "https://example.com/reference1.jpg"},
      {"type": "reference_video", "url": "https://example.com/reference.mp4"},
      {"type": "reference_audio", "url": "https://example.com/reference.mp3"}
    ]
  },
  "parameters": {
    "resolution": "480P",
    "ratio": "adaptive",
    "duration": 5
  }
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl ${submitUrl} \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -H "X-DashScope-Async: enable" \\
  -d '{
    "model": "${WAN_MODEL}",
    "input": {
      "prompt": "${t('The subject from image 1 follows the motion of video 1, with audio 1 as the background rhythm')}",
      "media": [
        {"type": "reference_image", "url": "https://example.com/reference1.jpg"},
        {"type": "reference_video", "url": "https://example.com/reference.mp4"},
        {"type": "reference_audio", "url": "https://example.com/reference.mp3"}
      ]
    },
    "parameters": {
      "resolution": "480P",
      "ratio": "adaptive",
      "duration": 5
    }
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={wanSubmitResponse}
              />
              <Note>
                <DocText
                  text={t(
                    'Keep the returned `output.task_id` for querying the task. Tasks are asynchronous: poll the query endpoint until `task_status` reaches a terminal state.'
                  )}
                />
              </Note>
              <Note>
                <DocText
                  text={t(
                    'First/last frame media (`first_frame` / `last_frame`) cannot be mixed with reference media (`reference_image` / `reference_video` / `reference_audio`) in one request; the first & last frame mode accepts images only.'
                  )}
                />
              </Note>
            </>
          ),
        },
        {
          id: 'wan-text',
          title: t('Text-to-Video'),
          body: (
            <>
              <P>{t('Generates a video from a text prompt only.')}</P>
              <CodeBlock
                method='POST'
                url={submitUrl}
                lang='json'
                code={`{
  "model": "${WAN_MODEL}",
  "input": {
    "prompt": "${t('An orange cat running on a sunlit grassland, bright and sunny')}"
  },
  "parameters": {
    "resolution": "480P",
    "ratio": "adaptive",
    "duration": 5
  }
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl ${submitUrl} \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -H "X-DashScope-Async: enable" \\
  -d '{
    "model": "${WAN_MODEL}",
    "input": {
      "prompt": "${t('An orange cat running on a sunlit grassland, bright and sunny')}"
    },
    "parameters": {
      "resolution": "480P",
      "ratio": "adaptive",
      "duration": 5
    }
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={wanSubmitResponse}
              />
              <Note>
                <DocText
                  text={t(
                    'Keep the returned `output.task_id` for querying the task. Tasks are asynchronous: poll the query endpoint until `task_status` reaches a terminal state.'
                  )}
                />
              </Note>
            </>
          ),
        },
        {
          id: 'wan-frames',
          title: t('First & Last Frame'),
          body: (
            <>
              <P>
                <DocText
                  text={t(
                    'Specify the first and last frame of the video via `first_frame` and `last_frame`; the model generates the transitional content in between.'
                  )}
                />
              </P>
              <CodeBlock
                method='POST'
                url={submitUrl}
                lang='json'
                code={`{
  "model": "${WAN_MODEL}",
  "input": {
    "prompt": "${t('A city skyline transitioning from day to night')}",
    "media": [
      {"type": "first_frame", "url": "https://example.com/first-frame.jpg"},
      {"type": "last_frame", "url": "https://example.com/last-frame.jpg"}
    ]
  },
  "parameters": {
    "resolution": "480P",
    "ratio": "adaptive",
    "duration": 5
  }
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl ${submitUrl} \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -H "X-DashScope-Async: enable" \\
  -d '{
    "model": "${WAN_MODEL}",
    "input": {
      "prompt": "${t('A city skyline transitioning from day to night')}",
      "media": [
        {"type": "first_frame", "url": "https://example.com/first-frame.jpg"},
        {"type": "last_frame", "url": "https://example.com/last-frame.jpg"}
      ]
    },
    "parameters": {
      "resolution": "480P",
      "ratio": "adaptive",
      "duration": 5
    }
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={wanSubmitResponse}
              />
              <Note>
                <DocText
                  text={t(
                    'Keep the returned `output.task_id` for querying the task. Tasks are asynchronous: poll the query endpoint until `task_status` reaches a terminal state.'
                  )}
                />
              </Note>
            </>
          ),
        },
        {
          id: 'wan-first-frame',
          title: t('First Frame'),
          body: (
            <>
              <P>
                <DocText
                  text={t(
                    'Pass a single first frame via `input.media` with `type: "first_frame"`; the model animates the image starting from that exact frame.'
                  )}
                />
              </P>
              <CodeBlock
                method='POST'
                url={submitUrl}
                lang='json'
                code={`{
  "model": "${WAN_MODEL}",
  "input": {
    "prompt": "${t('A cat running on the grassland, cinematic lighting')}",
    "media": [
      {"type": "first_frame", "url": "https://example.com/first-frame.jpg"}
    ]
  },
  "parameters": {
    "resolution": "480P",
    "ratio": "adaptive",
    "duration": 5
  }
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl ${submitUrl} \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -H "X-DashScope-Async: enable" \\
  -d '{
    "model": "${WAN_MODEL}",
    "input": {
      "prompt": "${t('A cat running on the grassland, cinematic lighting')}",
      "media": [
        {"type": "first_frame", "url": "https://example.com/first-frame.jpg"}
      ]
    },
    "parameters": {
      "resolution": "480P",
      "ratio": "adaptive",
      "duration": 5
    }
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={wanSubmitResponse}
              />
              <Note>
                <DocText
                  text={t(
                    'Keep the returned `output.task_id` for querying the task. Tasks are asynchronous: poll the query endpoint until `task_status` reaches a terminal state.'
                  )}
                />
              </Note>
            </>
          ),
        },
      ],
    },
    {
      id: 'wan-query',
      title: t('Query Video Generation Task'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Queries the latest task status in real time. When `task_status` is `SUCCEEDED`, `output.video_url` contains the generated video download URL and `usage` reports the actual billed duration and resolution.'
              )}
            />
          </P>
          <CodeBlock
            method='GET'
            url={`${tasksUrl}/{task_id}`}
            lang='bash'
            code={`# ${t('Replace {task_id} with the id returned by the task submission')}
curl ${tasksUrl}/{task_id} \\
  -H "Authorization: Bearer ${t('sk-your-token')}"`}
          />
          <CodeBlock
            title={t('Response example')}
            lang='json'
            code={`{
  "output": {
    "task_id": "a8532587-fa8c-4ef8-82be-0c46b17950d1",
    "task_status": "SUCCEEDED",
    "submit_time": "2026-01-01 12:00:00.000",
    "end_time": "2026-01-01 12:01:30.000",
    "video_url": "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/xxx/demo.mp4"
  },
  "usage": {
    "duration": 5,
    "video_count": 1,
    "SR": 480
  },
  "request_id": "caa089cb-b78c-42a5-9d1a-3f19b1a44b83"
}`}
          />
          <Note>
            <DocText
              text={t(
                'Task status flow: `PENDING` → `RUNNING` → `SUCCEEDED` / `FAILED` / `CANCELED` / `UNKNOWN`. Failed tasks include `code` and `message` describing the failure reason.'
              )}
            />
          </Note>
        </>
      ),
    },
  ]
}