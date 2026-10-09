const WORKER_URL = 'https://ai-story-house-worker.liuwn2255.workers.dev';
const REQUEST_TIMEOUT_MS = 65_000;
const STORY_IMAGE_STATUSES = Object.freeze(['pending', 'ready', 'failed']);

/** Normalizes image metadata and remains compatible with older saved AI stories. */
export function getStoryImageState(story) {
  const coverImage = typeof story?.coverImage === 'string' ? story.coverImage.trim() : '';
  const imageStatus = STORY_IMAGE_STATUSES.includes(story?.imageStatus) ? story.imageStatus : 'pending';
  return { coverImage, imageStatus };
}

function imageError(message, code = 'IMAGE_GENERATION_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function storyCharacters(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join('、');
  return typeof value === 'string' ? value : '';
}

function decodeWebp(data) {
  if (typeof data !== 'string' || !data || data.length > 30_000_000) {
    throw imageError('圖片服務回傳的圖片資料不完整。', 'INVALID_IMAGE_RESPONSE');
  }

  let binary;
  try {
    binary = atob(data);
  } catch {
    throw imageError('圖片服務回傳的圖片資料格式不正確。', 'INVALID_IMAGE_RESPONSE');
  }

  if (binary.length < 12
    || binary.slice(0, 4) !== 'RIFF'
    || binary.slice(8, 12) !== 'WEBP') {
    throw imageError('圖片服務回傳的內容不是有效的 WebP 圖片。', 'INVALID_IMAGE_RESPONSE');
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: 'image/webp' });
}

/** Calls the existing Worker once and returns an in-memory WebP Blob for IndexedDB storage. */
export async function generateStoryImage(story, { testFixture = false } = {}) {
  if (!story || typeof story !== 'object' || story.type !== 'ai' || !story.id) {
    return {
      ok: false,
      status: 'failed',
      blob: null,
      coverImage: '',
      imageStatus: 'failed',
      error: { code: 'INVALID_STORY', message: '故事資料不完整，無法準備插圖。' },
    };
  }

  if (testFixture && import.meta.env.DEV) {
    try {
      const { default: fixtureUrl } = await import('../assets/stories/little-red-riding-hood/scene-01.webp?url');
      const fixtureResponse = await fetch(fixtureUrl);
      if (!fixtureResponse.ok) throw new Error('Fixture image could not be loaded');
      const blob = await fixtureResponse.blob();
      if (blob.type !== 'image/webp') throw new Error('Fixture is not WebP');
      return { ok: true, status: 'ready', blob, coverImage: '', imageStatus: 'ready' };
    } catch {
      return {
        ok: false, status: 'failed', blob: null, coverImage: '', imageStatus: 'failed',
        error: { code: 'TEST_IMAGE_UNAVAILABLE', message: '本機測試插畫無法載入。' },
      };
    }
  }

  const payload = {
    title: typeof story.title === 'string' ? story.title : '',
    characters: storyCharacters(story.characters),
    setting: typeof story.setting === 'string' ? story.setting : '',
    theme: typeof story.theme === 'string' ? story.theme : '',
    style: typeof story.style === 'string' ? story.style : '',
    age: typeof story.age === 'string' ? story.age : '',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${WORKER_URL}/api/story-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });

    let result;
    try {
      result = await response.json();
    } catch {
      throw imageError('圖片服務回傳格式不正確，請稍後再試。', 'INVALID_IMAGE_RESPONSE');
    }

    if (!response.ok || result?.ok !== true) {
      throw imageError(
        result?.error?.message || '圖片生成失敗，請稍後再試。',
        result?.error?.code || `HTTP_${response.status}`,
      );
    }

    if (result.image?.status !== 'ready' || result.image?.mimeType !== 'image/webp') {
      throw imageError('圖片服務尚未回傳可保存的圖片資料。', 'INVALID_IMAGE_RESPONSE');
    }

    const blob = decodeWebp(result.image.data);
    return { ok: true, status: 'ready', blob, coverImage: '', imageStatus: 'ready' };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        ok: false, status: 'failed', blob: null, coverImage: '', imageStatus: 'failed',
        error: { code: 'IMAGE_REQUEST_TIMEOUT', message: '圖片準備時間較長，請稍後再試。' },
      };
    }
    if (error instanceof TypeError) {
      return {
        ok: false, status: 'failed', blob: null, coverImage: '', imageStatus: 'failed',
        error: { code: 'IMAGE_NETWORK_ERROR', message: '目前無法連線到圖片服務，請稍後再試。' },
      };
    }
    return {
      ok: false, status: 'failed', blob: null, coverImage: '', imageStatus: 'failed',
      error: { code: error.code || 'IMAGE_GENERATION_FAILED', message: error.message || '圖片生成失敗，請稍後再試。' },
    };
  } finally {
    clearTimeout(timeout);
  }
}
