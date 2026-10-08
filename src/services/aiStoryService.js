const WORKER_URL = 'https://ai-story-house-worker.liuwn2255.workers.dev';
const REQUEST_TIMEOUT_MS = 65_000;
const MAX_SCENES = 24;

function storyError(message, code = 'STORY_REQUEST_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateStory(story, options) {
  if (!story || typeof story !== 'object' || story.ok === false) {
    throw storyError('故事服務回傳的資料格式不正確。', 'INVALID_STORY');
  }
  if (typeof story.id !== 'string' || !story.id.trim()
    || typeof story.title !== 'string' || !story.title.trim()
    || story.type !== 'ai'
    || typeof story.characters !== 'string'
    || typeof story.setting !== 'string'
    || typeof story.theme !== 'string'
    || typeof story.age !== 'string'
    || typeof story.style !== 'string'
    || !Number.isInteger(story.storyDuration) || story.storyDuration !== options.storyDuration
    || typeof story.createdAt !== 'string' || Number.isNaN(Date.parse(story.createdAt))
    || typeof story.favorite !== 'boolean'
    || !Array.isArray(story.scenes)
    || story.scenes.length < 1 || story.scenes.length > MAX_SCENES) {
    throw storyError('故事服務回傳的資料不完整，請稍後再試。', 'INVALID_STORY');
  }
  const { min, max } = options.targetSceneCount;
  if (story.scenes.length < min || story.scenes.length > max) {
    throw storyError('故事場景數與所選長度不符，請重新創作。', 'INVALID_SCENE_COUNT');
  }
  if (!story.scenes.every((scene) => scene
    && typeof scene.id === 'string' && scene.id.trim()
    && typeof scene.title === 'string' && scene.title.trim()
    && typeof scene.text === 'string' && scene.text.trim()
    && typeof scene.image === 'string'
    && typeof scene.audio === 'string')) {
    throw storyError('故事內容不完整，請重新創作。', 'INVALID_STORY');
  }
  return story;
}

/** 透過 AI Story House Cloudflare Worker 建立並驗證故事。 */
export async function generateStory(options) {
  if (!options || typeof options !== 'object') {
    throw storyError('故事設定不完整，請檢查表單內容。', 'INVALID_OPTIONS');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const characters = [options.character, options.companion].filter(Boolean).join('與');
  const payload = {
    theme: options.theme,
    characters,
    setting: options.setting,
    style: options.style,
    age: options.age,
    storyDuration: options.storyDuration,
    targetSceneCount: options.targetSceneCount,
  };

  try {
    const response = await fetch(`${WORKER_URL}/api/story`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let result;
    try {
      result = await response.json();
    } catch {
      throw storyError('故事服務暫時無法讀取回應，請稍後再試。', 'INVALID_RESPONSE');
    }

    if (!response.ok || result?.ok === false) {
      const message = result?.error?.message || '故事創作暫時失敗，請稍後再試。';
      throw storyError(message, result?.error?.code || `HTTP_${response.status}`);
    }

    return validateStory(result, options);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw storyError('故事創作等待時間較長，請稍後重試。', 'REQUEST_TIMEOUT');
    }
    if (error instanceof TypeError) {
      throw storyError('目前無法連線到故事服務，請確認網路後重試。', 'NETWORK_ERROR');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
