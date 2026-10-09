const STORAGE_KEY = 'ai-story-house-stories';

function isImageBinary(value) {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof File !== 'undefined' && value instanceof File) return true;
  if (value instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(value)) return true;
  return typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
}

function isImageDataString(value) {
  const text = value.trim();
  if (/^(?:data:image\/|blob:)/i.test(text)) return true;

  const compact = text.replace(/\s/g, '');
  return compact.length >= 8
    && /^(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR|PHN2Zy)/.test(compact);
}

function sanitizeValue(value) {
  if (isImageBinary(value)) return undefined;
  if (typeof value === 'string') return isImageDataString(value) ? undefined : value;
  if (Array.isArray(value)) {
    return value.map(sanitizeValue).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    const safeItem = sanitizeValue(item);
    if (safeItem !== undefined) sanitized[key] = safeItem;
    else if (key === 'image' || key === 'coverImage') sanitized[key] = '';
  }
  return sanitized;
}

function normalizeStory(story) {
  const normalized = sanitizeValue(story);
  if (normalized?.type === 'ai') normalized.coverImage = '';
  return normalized;
}

function saveStories(stories) {
  const normalized = stories.map(normalizeStory);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getStories() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveStory(story) {
  const stories = getStories();
  const next = [story, ...stories.filter((item) => item.id !== story.id)];
  return saveStories(next);
}

export function updateStory(id, patch) {
  const stories = getStories();
  const index = stories.findIndex((story) => story.id === id);
  if (index < 0 || !patch || typeof patch !== 'object') return null;

  const updated = normalizeStory({ ...stories[index], ...patch, id: stories[index].id });
  stories[index] = updated;
  const saved = saveStories(stories);
  return saved[index];
}

export function deleteStory(id) {
  const next = getStories().filter((story) => story.id !== id);
  return saveStories(next);
}

export function toggleFavorite(id, sourceStory) {
  const stories = getStories();
  const exists = stories.some((story) => story.id === id);
  const next = exists
    ? stories.map((story) => story.id === id ? { ...story, favorite: !story.favorite } : story)
    : sourceStory ? [{ ...sourceStory, favorite: true }, ...stories] : stories;
  return saveStories(next);
}
