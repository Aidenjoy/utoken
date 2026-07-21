export type PlaygroundMode = 'chat' | 'video'

const VIDEO_MODEL_PATTERNS = [
  /seedance/i,
  /sora/i,
  /hailuo/i,
  /vidu/i,
  /kling/i,
  /jimeng/i,
  /veo/i,
  /wan-/i,
  /hunyuanvideo/i,
  /pika/i,
  /video/i,
]

export function getModelType(modelName: string): PlaygroundMode {
  if (VIDEO_MODEL_PATTERNS.some((p) => p.test(modelName))) {
    return 'video'
  }
  return 'chat'
}
