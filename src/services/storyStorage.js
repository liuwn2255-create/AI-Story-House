const STORAGE_KEY = 'ai-story-house-stories';

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteStory(id) {
  const next = getStories().filter((story) => story.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function toggleFavorite(id, sourceStory) {
  const stories = getStories();
  const exists = stories.some((story) => story.id === id);
  const next = exists
    ? stories.map((story) => story.id === id ? { ...story, favorite: !story.favorite } : story)
    : sourceStory ? [{ ...sourceStory, favorite: true }, ...stories] : stories;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
