import './styles/main.css';
import './styles/storyDuration.css';
import storytellerAvatar from './assets/storyteller-avatar.webp';
import { classicStories } from './data/classicStories.js';
import { getStoryDurationSettings, storyDurationOptions } from './data/storyDurationOptions.js';
import { generateStory } from './services/aiStoryService.js';
import { generateStoryImage, getStoryImageState } from './services/storyImageService.js';
import { deleteStoryImage, getStoryImage, saveStoryImage } from './services/storyImageStorage.js';
import { deleteStory, getStories, saveStory, toggleFavorite, updateStory } from './services/storyStorage.js';
import { getVoiceDescription, isSpeechSynthesisSupported, pause, playScene, resume, stop } from './services/voiceService.js';

const app = document.querySelector('#app');
let currentStory = null;
let sceneIndex = 0;
let libraryFilter = 'all';
let activeReaderStoryId = null;
let voiceState = 'idle';
let voiceAutoPlayback = false;
let isStoryAutoPlaying = false;
let storyAutoPlaySessionId = 0;
let voiceMessage = '';
let voiceRate = 0.9;
let readerNotice = '';
let readerCoverImageUrl = '';
let readerCoverImageStoryId = null;
let readerCoverImageUnavailableStoryId = null;
let imageRestoreStoryId = null;
let imageTestBusy = false;
let imageGenerationBusy = false;
let imageGenerationStoryId = null;
let imageRequestMessage = '';
let storyCardImageUrls = new Set();
let storyCardImageRenderId = 0;
const imageTestMode = import.meta.env.DEV && new URLSearchParams(location.search).get('imageTest') === '1';

function cancelStoryAutoPlayback() {
  isStoryAutoPlaying = false;
  storyAutoPlaySessionId += 1;
}

function stopReaderSpeech() {
  cancelStoryAutoPlayback();
  stop();
  voiceState = 'idle';
  voiceAutoPlayback = false;
  voiceMessage = '';
}

function playCurrentScene({ automatic = false, advanceOnEnd = true, autoPlaySessionId = null } = {}) {
  const storyId = currentStory?.id;
  const playedSceneIndex = sceneIndex;
  const scene = currentStory?.scenes?.[playedSceneIndex];
  voiceAutoPlayback = automatic;
  const isCurrentPlayback = () => currentStory?.id === storyId
    && sceneIndex === playedSceneIndex
    && activeReaderStoryId === storyId
    && location.hash === `#reader/${encodeURIComponent(storyId)}`
    && (autoPlaySessionId === null || (isStoryAutoPlaying && autoPlaySessionId === storyAutoPlaySessionId));

  try {
    const voice = playScene(scene, {
      rate: voiceRate,
      onEnd: () => {
        if (!isCurrentPlayback()) return;
        if (advanceOnEnd && playedSceneIndex < currentStory.scenes.length - 1) {
          sceneIndex = playedSceneIndex + 1;
          voiceState = 'idle';
          voiceMessage = '';
          render();
          playCurrentScene({ automatic: true, autoPlaySessionId });
          return;
        }
        if (autoPlaySessionId !== null) cancelStoryAutoPlayback();
        voiceState = 'idle';
        voiceAutoPlayback = false;
        voiceMessage = '故事朗讀完成。';
        render();
      },
      onError: (error) => {
        if (!isCurrentPlayback()) return;
        if (autoPlaySessionId !== null) cancelStoryAutoPlayback();
        voiceState = 'error';
        voiceAutoPlayback = false;
        voiceMessage = error.message;
        render();
      },
    });
    voiceState = 'speaking';
    voiceMessage = `正在朗讀（${voice.voiceDescription}）。`;
  } catch (error) {
    if (autoPlaySessionId !== null) cancelStoryAutoPlayback();
    voiceState = 'error';
    voiceAutoPlayback = false;
    voiceMessage = error.message || '語音播放失敗，請稍後再試。';
  }
  render();
}

function startStoryAutoPlayback() {
  if (!isSpeechSynthesisSupported() || isStoryAutoPlaying || !currentStory?.scenes?.length) return;
  stop();
  voiceState = 'idle';
  voiceAutoPlayback = false;
  voiceMessage = '';
  isStoryAutoPlaying = true;
  const sessionId = ++storyAutoPlaySessionId;
  playCurrentScene({ automatic: true, autoPlaySessionId: sessionId });
}

function revokeReaderCoverImageUrl() {
  if (readerCoverImageUrl) URL.revokeObjectURL(readerCoverImageUrl);
  readerCoverImageUrl = '';
  readerCoverImageStoryId = null;
}

function setStoryImageFailed(storyId) {
  if (readerCoverImageStoryId === storyId) revokeReaderCoverImageUrl();
  const patch = { coverImage: '', imageStatus: 'failed' };
  try { updateStory(storyId, patch); } catch { /* Image failure must not interrupt story reading. */ }
  if (currentStory?.id === storyId) currentStory = { ...currentStory, ...patch };
}

async function restoreReaderCoverImage(story) {
  if (!story || story.type !== 'ai' || readerCoverImageStoryId === story.id || readerCoverImageUnavailableStoryId === story.id || imageRestoreStoryId === story.id) return;
  const { imageStatus } = getStoryImageState(story);
  if (imageStatus !== 'ready') return;

  imageRestoreStoryId = story.id;
  try {
    const blob = await getStoryImage(story.id);
    if (currentStory?.id !== story.id || !location.hash.startsWith('#reader/')) return;
    if (!(blob instanceof Blob) || !blob.type.startsWith('image/')) {
      readerCoverImageUnavailableStoryId = story.id;
      render();
      return;
    }
    readerCoverImageUrl = URL.createObjectURL(blob);
    readerCoverImageStoryId = story.id;
    readerCoverImageUnavailableStoryId = null;
    render();
  } catch {
    if (currentStory?.id === story.id && location.hash.startsWith('#reader/')) {
      readerCoverImageUnavailableStoryId = story.id;
      render();
    }
  } finally {
    if (imageRestoreStoryId === story.id) imageRestoreStoryId = null;
  }
}

async function runImageFixtureTest(story) {
  imageTestBusy = true;
  try {
    const result = await generateStoryImage(story, { testFixture: true });
    if (!result.ok || !result.blob) throw new Error(result.error?.message || '本機測試插畫無法載入。');

    await saveStoryImage(story.id, result.blob);
    const patch = { coverImage: '', imageStatus: 'ready' };
    const updated = updateStory(story.id, patch);
    if (!updated) throw new Error('故事未儲存，無法保存測試插畫狀態。');

    revokeReaderCoverImageUrl();
    currentStory = updated;
    readerCoverImageUnavailableStoryId = null;
    readerCoverImageUrl = URL.createObjectURL(result.blob);
    readerCoverImageStoryId = story.id;
    render();
  } catch (error) {
    setStoryImageFailed(story.id);
    render();
    const status = document.querySelector('.image-test-status');
    if (status) status.textContent = error.message || '測試插畫流程失敗，故事仍可繼續閱讀。';
  } finally {
    imageTestBusy = false;
  }
}

async function runStoryImageGeneration(story) {
  const missingReadyImage = story?.id && readerCoverImageUnavailableStoryId === story.id;
  if (!story || story.type !== 'ai' || (story.imageStatus === 'ready' && !missingReadyImage) || imageGenerationBusy) return;
  imageGenerationBusy = true;
  imageGenerationStoryId = story.id;
  imageRequestMessage = '🎨 正在創作故事插畫……';
  render();

  try {
    const result = await generateStoryImage(story);
    if (!result.ok || !(result.blob instanceof Blob)) {
      throw new Error(result.error?.message || '圖片生成失敗，請稍後再試。');
    }

    await saveStoryImage(story.id, result.blob);
    const updated = updateStory(story.id, { coverImage: '', imageStatus: 'ready' });
    if (!updated) {
      await deleteStoryImage(story.id).catch(() => {});
      throw new Error('插畫已產生，但故事資料無法更新，請稍後再試。');
    }

    if (readerCoverImageStoryId === story.id) revokeReaderCoverImageUrl();
    if (currentStory?.id === story.id && location.hash.startsWith('#reader/')) {
      currentStory = updated;
      readerCoverImageUnavailableStoryId = null;
      readerCoverImageUrl = URL.createObjectURL(result.blob);
      readerCoverImageStoryId = story.id;
    }
    imageRequestMessage = '✨ 故事插畫完成！';
  } catch (error) {
    setStoryImageFailed(story.id);
    imageRequestMessage = error.message || '圖片生成失敗，請稍後再試。';
  } finally {
    imageGenerationBusy = false;
    imageGenerationStoryId = null;
    if (location.hash.startsWith('#reader/')) render();
  }
}

const storyCategories = [
  ['動物故事', '🐰'],
  ['冒險故事', '🌳'],
  ['溫馨故事', '❤️'],
  ['勇氣故事', '🌟'],
  ['趣味故事', '😂'],
  ['睡前故事', '🌙'],
];

const protagonistChoices = [
  ['🐰', '小兔子'], ['🐱', '小貓咪'], ['🦊', '小狐狸'], ['🐻', '小熊'],
  ['🦖', '小恐龍'], ['🧒', '小男孩'], ['👧', '小女孩'],
];
const personalityChoices = [
  ['😊', '活潑'], ['🧠', '聰明'], ['😳', '害羞'],
  ['💪', '勇敢'], ['😂', '愛搞笑'], ['❤️', '溫柔'],
];
const storyIdeaCompanions = [
  '會說話的小鳥', '愛唱歌的小松鼠', '小小機器人', '神秘的小精靈',
  '一隻迷路的小狗', '愛吃蜂蜜的小熊', '會發光的小蝴蝶',
];
const storyIdeaSettings = [
  '彩虹森林', '月亮森林', '雲朵王國', '神秘城堡', '海底世界', '恐龍時代', '星星小鎮',
];
const storyIdeaThemes = [
  '勇氣與友誼', '幫助別人', '找回自信', '學會分享', '面對害怕', '發現自己的優點', '一場有趣的冒險',
];
let lastStoryIdea = null;

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildStoryInspiration(form) {
  const data = new FormData(form);
  const character = String(data.get('character') || '').trim();
  const companion = String(data.get('companion') || '').trim();
  const setting = String(data.get('setting') || '').trim();
  const theme = String(data.get('theme') || '').trim();
  const personalities = data.getAll('personality').map((value) => String(value).trim()).filter(Boolean);
  const storyCharacter = character
    ? `${personalities.length ? `${personalities.join('、')}的` : ''}${character}`
    : '';
  const lead = storyCharacter || '主角';

  if (theme) {
    const themeJourney = `以「${theme}」為主題的旅程`;
    if (setting && companion) return `在${setting}裡，${lead}遇見${companion}。他們將一起踏上${themeJourney}，途中會遇到什麼奇妙的事呢？`;
    if (setting) return `在${setting}裡，${lead}準備踏上${themeJourney}。`;
    if (companion) return `${lead}遇見${companion}，準備一起踏上${themeJourney}。`;
    return `${lead}即將展開${themeJourney}。`;
  }

  if (setting && companion) return `在${setting}裡，${lead}遇見${companion}，故事即將開始！`;
  if (setting) return `${lead}來到${setting}，故事即將開始！`;
  if (companion) return `${lead}遇見${companion}，故事即將開始！`;
  return `${lead}的故事即將開始！`;
}

function updateStoryInspiration(form) {
  const preview = form?.querySelector('#story-inspiration');
  const text = form?.querySelector('#story-inspiration-text');
  if (!preview || preview.hidden || !text) return;
  text.textContent = buildStoryInspiration(form);
}

function createStoryIdea() {
  const personalityNames = personalityChoices.map(([, name]) => name);
  const createCandidate = () => {
    const firstPersonality = randomItem(personalityNames);
    const personalities = [firstPersonality];
    if (Math.random() < 0.5) {
      personalities.push(randomItem(personalityNames.filter((name) => name !== firstPersonality)));
    }
    return {
      protagonist: randomItem(protagonistChoices)[1],
      personalities: personalities.sort(),
      companion: randomItem(storyIdeaCompanions),
      setting: randomItem(storyIdeaSettings),
      theme: randomItem(storyIdeaThemes),
    };
  };

  let idea = createCandidate();
  let attempts = 0;
  while (lastStoryIdea && JSON.stringify(idea) === JSON.stringify(lastStoryIdea) && attempts < 20) {
    idea = createCandidate();
    attempts += 1;
  }
  if (lastStoryIdea && JSON.stringify(idea) === JSON.stringify(lastStoryIdea)) {
    idea.theme = storyIdeaThemes[(storyIdeaThemes.indexOf(idea.theme) + 1) % storyIdeaThemes.length];
  }
  return idea;
}

const icon = (symbol) => `<span aria-hidden="true">${symbol}</span>`;
function avatarView(size = '') {
  return `<div class="avatar ${size}" aria-label="劉老師說故事頭像"><img src="${storytellerAvatar}" alt="劉老師" onload="this.nextElementSibling.hidden=true" onerror="this.hidden=true" /><span class="avatar-placeholder">劉</span></div>`;
}
function header() {
  return `<header class="site-header"><a class="brand" href="#home" data-page="home"><span class="brand-mark">✦</span><span>AI Story House<small>AI 故事小屋</small></span></a><button class="menu-toggle" aria-label="開啟導覽" aria-expanded="false">☰</button><nav class="main-nav" aria-label="主要導覽"><a href="#home" data-page="home">首頁</a><a href="#create" data-page="create">創作故事</a><a href="#library" data-page="library">故事書架</a><a href="#mine" data-page="mine">我的故事</a></nav></header>`;
}
function storyteller(compact = false) {
  return `<div class="storyteller ${compact ? 'compact' : ''}">${avatarView(compact ? 'avatar-small' : '')}<div><strong>劉老師</strong><span>陪你一起說故事</span></div></div>`;
}
function revokeStoryCardImageUrls() {
  storyCardImageRenderId += 1;
  storyCardImageUrls.forEach((url) => URL.revokeObjectURL(url));
  storyCardImageUrls.clear();
}
async function loadStoryCardImage(card, renderId) {
  const storyId = card.dataset.storyImageCard;
  if (!storyId) return;
  try {
    const blob = await getStoryImage(storyId);
    if (renderId !== storyCardImageRenderId || !card.isConnected || !(blob instanceof Blob) || !blob.type.startsWith('image/')) return;

    const url = URL.createObjectURL(blob);
    storyCardImageUrls.add(url);
    const image = document.createElement('img');
    image.className = 'story-card-thumbnail';
    image.alt = `${card.dataset.storyTitle || '故事'}插畫縮圖`;
    image.onload = () => {
      if (renderId !== storyCardImageRenderId || !card.isConnected) return;
      const placeholder = card.querySelector('[data-story-image-placeholder]');
      if (placeholder) placeholder.hidden = true;
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      storyCardImageUrls.delete(url);
      image.remove();
    };
    image.src = url;
    card.append(image);
  } catch {
    // Keep the card illustration placeholder when IndexedDB is unavailable or the image is missing.
  }
}
function restoreVisibleStoryCardImages() {
  const renderId = storyCardImageRenderId;
  app.querySelectorAll('[data-story-image-card]').forEach((card) => {
    void loadStoryCardImage(card, renderId);
  });
}
function storyCard(story, actionLabel = '開始閱讀') {
  const imageStatus = story.type === 'ai'
    ? ['pending', 'ready', 'failed'].includes(story.imageStatus) ? story.imageStatus : 'pending'
    : '';
  const imageStatusLabels = {
    pending: '🎨 尚未生成插畫',
    ready: '🖼️ 已有插畫',
    failed: '⚠️ 插畫生成失敗',
  };
  const imageStatusBadge = imageStatus
    ? `<small class="story-card-image-status status-${imageStatus}">${imageStatusLabels[imageStatus]}</small>`
    : '';
  const hasAiCoverImage = story.type === 'ai' && story.imageStatus === 'ready';
  const storyArt = hasAiCoverImage
    ? `<div class="story-card-art ai-story-art" data-story-image-card="${escapeHtml(story.id)}" data-story-title="${escapeHtml(story.title)}"><span data-story-image-placeholder aria-hidden="true">✨</span></div>`
    : `<div class="story-card-art ${story.type === 'classic' ? 'classic-art' : ''}">${story.type === 'classic' ? '🌙' : '✨'}</div>`;
  return `<article class="story-card">${storyArt}<div class="story-card-body"><span class="eyebrow">${story.type === 'classic' ? '經典故事' : 'AI 故事'}</span><h3>${escapeHtml(story.title)}</h3><p>${escapeHtml(story.theme || '一段奇妙的故事')} · ${story.scenes?.length ?? 0} 個場景</p>${imageStatusBadge}<div class="card-actions"><button class="text-button" data-read="${story.id}" data-source="${story.type}">${actionLabel} →</button>${story.type !== 'classic' ? `<button class="icon-button" title="刪除故事" aria-label="刪除故事" data-delete="${story.id}">⌫</button>` : ''}</div></div></article>`;
}
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function getReaderDurationInfo(story) {
  if (!story || (story.type !== 'ai' && !story.options)) return null;

  const rawDuration = story.storyDuration ?? story.options?.storyDuration;
  const parsedDuration = Number(rawDuration);
  const hasValidDuration = Number.isInteger(parsedDuration) && parsedDuration >= 1 && parsedDuration <= 30;
  const duration = hasValidDuration ? parsedDuration : 5;
  const fallback = getStoryDurationSettings(String(duration), duration);
  const savedRange = story.options?.targetSceneCount;
  const hasValidRange = Number.isInteger(savedRange?.min)
    && Number.isInteger(savedRange?.max)
    && savedRange.min >= 1
    && savedRange.max >= savedRange.min
    && savedRange.max <= 24;

  return {
    durationLabel: hasValidDuration && typeof story.options?.durationLabel === 'string' && story.options.durationLabel.trim()
      ? story.options.durationLabel
      : fallback.durationLabel,
    targetSceneCount: hasValidDuration && hasValidRange ? savedRange : fallback.targetSceneCount,
  };
}
function getTodayRecommendedStory() {
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  return classicStories[dayOfYear % classicStories.length];
}
function homePage() {
  const saved = getStories();
  const recommendedStory = getTodayRecommendedStory();
  return `<main><section class="hero"><div class="hero-copy"><span class="eyebrow">WELCOME TO OUR STORY HOUSE</span><div class="home-brand">${avatarView()}<div><h1>劉老師說故事</h1><p>陪你一起說故事</p></div></div><p>在想像力的小屋裡，讓我們一起翻開故事的第一頁。</p><button class="button button-primary" data-page="create">✨ AI 創作故事</button></div><div class="hero-art"><div class="sun-orb"></div><div class="book-illustration"><span class="book-star">✦</span><span class="book-title">很久很久<br />以前⋯⋯</span><span class="book-flower">✿</span></div><span class="float-note note-one">✧</span><span class="float-note note-two">✦</span><div class="art-caption">你的下一個故事，從這裡開始</div></div></section><section class="section-block"><div class="section-heading"><div><span class="eyebrow">QUICK START</span><h2>想從哪裡開始？</h2></div></div><div class="feature-grid"><button class="feature-tile" data-page="create"><span class="feature-icon peach">✨</span><strong>AI 創作故事</strong><span>把你的想法變成故事</span></button><button class="feature-tile" data-page="library"><span class="feature-icon blue">📚</span><strong>經典故事</strong><span>探索故事小屋的經典故事</span></button><button class="feature-tile" data-page="mine"><span class="feature-icon yellow">❤️</span><strong>我的故事</strong><span>收藏屬於你的回憶</span></button><button class="feature-tile" data-category="ray"><span class="feature-icon peach">👦👧</span><strong>Ray & Tracy 故事</strong><span>閱讀專屬冒險故事</span></button></div></section><section class="section-block"><div class="section-heading"><div><span class="eyebrow">EXPLORE BY THEME</span><h2>故事主題</h2></div></div><div class="theme-grid">${storyCategories.map(([category, emoji]) => `<button class="theme-card" data-category="${category}"><span aria-hidden="true">${emoji}</span><strong>${category}</strong></button>`).join('')}</div></section><section class="section-block today-section"><div class="section-heading"><div><span class="eyebrow">A STORY FOR TODAY</span><h2>📖 今日推薦</h2></div></div><div class="today-story">${storyCard(recommendedStory, '開始閱讀')}</div></section>${saved.length ? `<section class="section-block"><div class="section-heading"><div><span class="eyebrow">YOUR STORIES</span><h2>最近的故事</h2></div><a href="#mine" data-page="mine" class="subtle-link">查看全部 →</a></div><div class="story-grid">${saved.slice(0, 3).map((story) => storyCard(story)).join('')}</div></section>` : ''}</main>`;
}
function createPage() {
  const durationCards = storyDurationOptions.map((option) => `<label class="duration-card"><input type="radio" name="durationChoice" value="${option.value}" ${option.value === '5' ? 'checked' : ''} /><span class="duration-card-content"><span class="duration-icon">${option.icon}</span><strong>${option.title}</strong><span>${option.description}</span><small>約 ${option.scenes.min}${option.scenes.max !== option.scenes.min ? `～${option.scenes.max}` : ''} 個場景</small></span></label>`).join('');
  const protagonistButtons = protagonistChoices.map(([emoji, name]) => `<button class="character-choice" type="button" data-character-choice="${name}" aria-pressed="false">${emoji} ${name}</button>`).join('');
  const personalityOptions = personalityChoices.map(([emoji, name]) => `<label class="personality-option"><input type="checkbox" name="personality" value="${name}" /><span>${emoji} ${name}</span></label>`).join('');
  return `<main class="page-shell"><div class="page-intro"><span class="eyebrow">MAKE A LITTLE MAGIC</span><h1>來編一個故事吧</h1><p>選擇你喜歡的元素，故事就從想像開始。</p></div><div class="form-layout"><form class="story-form" id="story-form"><label>故事主角<input name="character" placeholder="例如：勇敢的小兔子" required maxlength="100" /></label><fieldset class="character-choice-fieldset"><legend>🌟 選擇主角</legend><div class="character-choice-list">${protagonistButtons}<button class="character-choice" type="button" data-character-custom>✏️ 自訂角色</button></div></fieldset><fieldset class="personality-fieldset"><legend>💖 角色個性（可複選）</legend><div class="personality-list">${personalityOptions}</div></fieldset><div class="story-idea-helper"><button class="story-idea-button" type="button" data-story-idea>🎲 幫我想一個故事</button><span>不知道要寫什麼？讓我幫你想一個</span><p id="story-idea-status" role="status" aria-live="polite" hidden></p><section class="story-inspiration" id="story-inspiration" aria-labelledby="story-inspiration-title" hidden><h3 id="story-inspiration-title">💡 故事靈感</h3><p id="story-inspiration-text" aria-live="polite"></p></section></div><div class="form-row"><label>年齡<select name="age"><option>3–5 歲</option><option selected>6–8 歲</option><option>9–12 歲</option><option>親子共讀</option></select></label><label>故事風格<select name="style"><option>溫暖療癒</option><option>奇幻冒險</option><option>幽默有趣</option><option>睡前晚安</option></select></label></div><fieldset class="duration-fieldset"><legend>故事長度</legend><div class="duration-grid">${durationCards}<label class="duration-card"><input type="radio" name="durationChoice" value="custom" /><span class="duration-card-content"><span class="duration-icon">⏱️</span><strong>自訂時間</strong><span>由你決定長度</span><small>依時間建議場景數</small></span></label></div><div class="custom-duration" hidden><label for="custom-story-duration">自訂分鐘數</label><div class="custom-duration-input"><input id="custom-story-duration" name="customStoryDuration" type="number" min="1" max="30" step="1" value="5" disabled /><span>分鐘</span></div></div></fieldset><label>故事場景<input name="setting" placeholder="例如：雲朵上的秘密花園" maxlength="160" /></label><label>故事主題<input name="theme" placeholder="例如：勇氣、分享、探索" maxlength="120" /></label><label>故事同伴<input name="companion" placeholder="例如：會說話的小狐狸" maxlength="100" /></label><button class="button button-primary full-button" type="submit">✨ 開始創作故事</button><p class="form-note" id="story-form-status" role="status" aria-live="polite">將依照你的設定創作一則專屬故事。</p></form><aside class="form-aside"><div class="aside-doodle">✦</div>${storyteller()}<h3>想像力沒有標準答案</h3><p>主角可以是任何人，場景也可以在任何地方。準備好就開始吧！</p></aside></div></main>`;
}
function libraryPage() {
  const filters = [['all', '全部故事'], ['ai', '🤖 AI 故事'], ['classic', '📚 經典故事'], ['favorite', '⭐ 我的收藏'], ['ray', '🧒 Ray & Tracy']];
  const savedStories = getStories();
  let stories = [...classicStories.filter((story) => !savedStories.some((saved) => saved.id === story.id)), ...savedStories];
  if (libraryFilter === 'ai') stories = stories.filter((story) => story.type === 'ai');
  if (libraryFilter === 'classic') stories = stories.filter((story) => story.type === 'classic');
  if (libraryFilter === 'favorite') stories = stories.filter((story) => story.favorite);
  if (libraryFilter === 'ray') stories = stories.filter((story) => Array.isArray(story.characters) && story.characters.some((name) => /ray|tracy/i.test(name)));
  if (storyCategories.some(([category]) => category === libraryFilter)) {
    stories = stories.filter((story) => Array.isArray(story.categories) && story.categories.includes(libraryFilter));
  }
  return `<main class="page-shell"><div class="page-intro"><span class="eyebrow">STORY LIBRARY</span><h1>故事書架</h1><p>挑一本喜歡的故事，找個舒服的位置，一起讀下去。</p></div><div class="filter-row">${filters.map(([id, label]) => `<button class="filter-chip ${libraryFilter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`).join('')}</div><h2 class="library-theme-heading">主題分類</h2><div class="filter-row theme-filter-row">${storyCategories.map(([category, emoji]) => `<button class="filter-chip ${libraryFilter === category ? 'active' : ''}" data-filter="${category}">${emoji} ${category}</button>`).join('')}</div><div class="story-grid">${stories.length ? stories.map((story) => storyCard(story)).join('') : `<div class="empty-state"><span>📖</span><h3>這個主題還沒有故事</h3><p>試試其他主題，繼續探索故事小屋。</p></div>`}</div></main>`;
}
function minePage() {
  const savedStories = getStories();
  const stories = savedStories.filter((story) => story.type === 'ai');
  const favorites = savedStories.filter((story) => story.favorite);
  return `<main class="page-shell"><div class="page-intro"><span class="eyebrow">YOUR OWN SHELF</span><h1>我的故事</h1><p>創作與收藏的小小故事，都收在這裡。</p></div><section class="mine-section"><div class="section-heading"><h2>✍️ 已創作故事</h2><span class="count-pill">${stories.length}</span></div><div class="story-grid">${stories.length ? stories.map((story) => storyCard(story)).join('') : `<div class="empty-state"><span>📝</span><h3>你的故事從第一個想法開始</h3><p>寫下主角與場景，打造專屬的故事設定。</p><button class="button button-secondary" data-page="create">開始創作 →</button></div>`}</div></section><section class="mine-section"><div class="section-heading"><h2>⭐ 收藏故事</h2><span class="count-pill">${favorites.length}</span></div><div class="story-grid">${favorites.length ? favorites.map((story) => storyCard(story)).join('') : `<p class="muted">閱讀時收藏的故事會出現在這裡。</p>`}</div></section></main>`;
}
function readerPage() {
  if (!currentStory) return `<main class="page-shell"><div class="empty-state"><span>📚</span><h2>先從書架選一本故事吧</h2><button class="button button-secondary" data-page="library">前往故事書架</button></div></main>`;
  const scene = currentStory.scenes[sceneIndex];
  const sceneCount = Math.max(1, currentStory.scenes.length);
  const currentSceneNumber = sceneIndex + 1;
  const sceneProgress = Math.round((currentSceneNumber / sceneCount) * 1000) / 10;
  const isAiStory = currentStory.type === 'ai';
  const { imageStatus: aiImageStatus } = isAiStory
    ? getStoryImageState(currentStory)
    : { imageStatus: '' };
  const storedCoverImageUrl = isAiStory && readerCoverImageStoryId === currentStory.id ? readerCoverImageUrl : '';
  const isGeneratingThisImage = imageGenerationBusy && imageGenerationStoryId === currentStory.id;
  const readerImageUnavailable = readerCoverImageUnavailableStoryId === currentStory.id;
    const displayImageStatus = isGeneratingThisImage
      ? 'pending'
      : aiImageStatus === 'ready' && !storedCoverImageUrl && !readerImageUnavailable
        ? 'restoring'
        : aiImageStatus === 'ready' && readerImageUnavailable
          ? 'missing'
        : aiImageStatus === 'failed'
          ? 'failed'
          : 'empty';
  const sceneImage = isAiStory
    ? storedCoverImageUrl
      ? `<div class="reader-scene-visual"><img class="reader-scene-image" data-ai-cover-image="${escapeHtml(currentStory.id)}" src="${escapeHtml(storedCoverImageUrl)}" alt="${escapeHtml(currentStory.title)}故事主圖" /><div class="reader-image-placeholder" hidden><span aria-hidden="true">🌿 ✦ 🌼</span><strong>故事畫面</strong><small>這次插圖暫時無法顯示</small></div></div>`
      : `<div class="reader-scene-visual"><div class="reader-image-placeholder ${displayImageStatus === 'pending' ? 'is-pending' : ''}" role="img" aria-label="${escapeHtml(currentStory.title)}故事插畫"><span aria-hidden="true">${displayImageStatus === 'failed' || displayImageStatus === 'missing' ? '🌿 ✦ 🌼' : '📖 ✦ 🌼'}</span><strong>${displayImageStatus === 'failed' ? '故事插畫' : displayImageStatus === 'missing' ? '插畫暫時遺失' : '📖 故事插畫'}</strong><small>${displayImageStatus === 'failed' ? '圖片生成失敗，請稍後再試。' : displayImageStatus === 'pending' ? '🎨 正在創作故事插畫……' : displayImageStatus === 'restoring' ? '正在載入已保存的故事插畫……' : displayImageStatus === 'missing' ? '找不到已保存的圖片，可手動重新生成。' : '精彩故事，陪你一起想像。'}</small></div></div>`
    : typeof scene.image === 'string' && scene.image.trim()
      ? `<div class="reader-scene-visual"><img class="reader-scene-image" src="${escapeHtml(scene.image)}" alt="${escapeHtml(currentStory.title)}：${escapeHtml(scene.title)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><div class="reader-image-placeholder" hidden><span aria-hidden="true">🌿 ✦ 🌼</span><strong>故事畫面</strong><small>這一幕的插畫暫時無法顯示</small></div></div>`
      : `<div class="reader-scene-visual"><div class="reader-image-placeholder" role="img" aria-label="${escapeHtml(scene.title)}的故事畫面預留位置"><span aria-hidden="true">🌿 ✦ 🌼</span><strong>故事畫面</strong><small>想像力正在描繪這一幕</small></div></div>`;
  const durationInfo = getReaderDurationInfo(currentStory);
  const durationSummary = durationInfo
    ? `<p class="reader-duration">⏱ ${escapeHtml(durationInfo.durationLabel)} · 預計 ${durationInfo.targetSceneCount.min}${durationInfo.targetSceneCount.max !== durationInfo.targetSceneCount.min ? `～${durationInfo.targetSceneCount.max}` : ''} 個場景</p>`
    : '';
  const supported = isSpeechSynthesisSupported();
  const status = !supported
    ? '此瀏覽器不支援語音朗讀，仍可照常閱讀故事。'
    : voiceMessage || (voiceState === 'speaking' ? '正在朗讀目前這一幕。' : voiceState === 'paused' ? '朗讀已暫停。' : '選擇播放，朗讀目前這一幕。');
  const playbackLabel = voiceState === 'speaking'
    ? voiceAutoPlayback ? '🔊 自動播放中' : '🔊 播放中'
    : voiceState === 'paused'
      ? '⏸️ 已暫停'
      : voiceState === 'error'
        ? '⚠️ 朗讀未播放'
        : voiceMessage === '故事朗讀完成。' ? '朗讀完成' : '尚未播放';
  const imageReady = aiImageStatus === 'ready';
    const imageGenerationControl = isAiStory
      ? `<div class="story-image-tools"><button class="button button-secondary story-image-generate" type="button" data-generate-story-image ${imageGenerationBusy || (imageReady && !readerImageUnavailable) ? 'disabled' : ''}>${isGeneratingThisImage ? '🎨 正在創作故事插畫……' : imageReady && !readerImageUnavailable ? '✨ 故事插畫已完成' : aiImageStatus === 'failed' || readerImageUnavailable ? '🎨 重新生成故事插畫' : '🎨 生成故事插畫'}</button><small class="story-image-status" aria-live="polite">${escapeHtml(imageRequestMessage || (aiImageStatus === 'failed' ? '圖片生成失敗，請稍後再試。' : imageReady && readerImageUnavailable ? '已保存的插畫找不到了，可手動重新生成。' : imageReady ? '故事插畫已完成' : '手動生成一張故事主圖，不會自動產生。'))}</small></div>`
    : '';
  const imageTestControl = imageTestMode && isAiStory
    ? `<div class="image-test-tools"><button class="text-button" data-image-test ${imageTestBusy ? 'disabled' : ''}>🧪 測試本機插畫流程</button><small class="image-test-status" aria-live="polite">只使用專案內的測試圖片，不會呼叫圖片 API。</small></div>`
    : '';
  return `<main class="reader-shell"><div class="reader-top"><button class="text-button" data-page="library">← 回到故事書架</button><button class="favorite-button ${currentStory.favorite ? 'is-favorite' : ''}" data-favorite="${currentStory.id}">${currentStory.favorite ? '★ 已收藏' : '☆ 收藏故事'}</button></div><article class="reader-card"><div class="reader-heading"><span class="eyebrow">${currentStory.type === 'classic' ? '經典故事' : 'AI 故事'}</span><h1>${escapeHtml(currentStory.title)}</h1>${durationSummary}${storyteller(true)}</div>${readerNotice ? `<p class="form-note" data-state="error" role="status">${escapeHtml(readerNotice)}</p>` : ''}${sceneImage}${imageGenerationControl}${imageTestControl}<div class="reader-scene"><div class="reader-progress"><span class="reader-progress-label">第 ${currentSceneNumber} 幕 / ${sceneCount} 幕</span><div class="reader-progress-track" role="progressbar" aria-label="閱讀進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${sceneProgress}"><span class="reader-progress-value" style="width:${sceneProgress}%"></span></div></div><h2>${escapeHtml(scene.title)}</h2><p>${escapeHtml(scene.text)}</p><div class="reader-narration-actions"><button class="reader-narration-button" data-narration type="button" ${!supported || isStoryAutoPlaying ? 'disabled' : ''}>${voiceState === 'speaking' || voiceState === 'paused' ? '⏹ 停止朗讀' : '🔊 朗讀'}</button><button class="reader-autoplay-button ${isStoryAutoPlaying ? 'is-active' : ''}" data-story-autoplay type="button" ${!supported ? 'disabled title="這個瀏覽器不支援語音朗讀"' : ''}>${isStoryAutoPlaying ? '⏹ 停止自動播放' : '▶ 自動播放'}</button></div></div><div class="reader-controls"><button class="button button-secondary" data-scene="prev" ${sceneIndex === 0 ? 'disabled' : ''}>← 上一幕</button><div class="scene-dots">${currentStory.scenes.map((_, i) => `<button aria-label="第 ${i + 1} 幕" class="scene-dot ${i === sceneIndex ? 'active' : ''}" data-scene-index="${i}"></button>`).join('')}</div><button class="button button-secondary" data-scene="next" ${sceneIndex === currentStory.scenes.length - 1 ? 'disabled' : ''}>下一幕 →</button></div><section class="reader-voice ${voiceState}" aria-label="故事語音控制"><div class="reader-voice-heading">${storyteller(true)}<div class="reader-voice-info"><strong>本幕語音朗讀</strong><span class="voice-status" aria-live="polite">${escapeHtml(status)}</span></div></div><div class="voice-playback-state" aria-live="polite"><span>${playbackLabel}</span><span>第 ${sceneIndex + 1} 幕／共 ${currentStory.scenes.length} 幕</span></div><div class="voice-actions"><button class="voice-button" data-voice="play" ${!supported || isStoryAutoPlaying ? 'disabled' : ''}>▶ 播放</button><button class="voice-button" data-voice="pause" ${!supported || voiceState !== 'speaking' ? 'disabled' : ''}>⏸ 暫停</button><button class="voice-button" data-voice="resume" ${!supported || voiceState !== 'paused' ? 'disabled' : ''}>▶ 繼續</button><button class="voice-button" data-voice="stop" ${!supported || voiceState === 'idle' ? 'disabled' : ''}>■ 停止</button></div><div class="voice-rate" aria-label="語速選擇"><span>語速</span>${[[0.75, '慢'], [0.9, '正常'], [1.05, '快']].map(([rate, label]) => `<button class="voice-rate-button" data-rate="${rate}" aria-pressed="${voiceRate === rate}" ${!supported ? 'disabled' : ''}>${label}</button>`).join('')}<small>${escapeHtml(getVoiceDescription())} · 速度套用於下次播放</small></div></section></article></main>`;
}
function render() {
  revokeStoryCardImageUrls();
  let page = location.hash.slice(1) || 'home';
  let nextReaderStoryId = null;
  if (page.startsWith('reader/')) {
    nextReaderStoryId = decodeURIComponent(page.slice('reader/'.length));
    if (activeReaderStoryId !== nextReaderStoryId) {
      cancelStoryAutoPlayback();
      stop();
      voiceState = 'idle';
      voiceAutoPlayback = false;
      voiceMessage = '';
      readerCoverImageUnavailableStoryId = null;
    }
    const savedStories = getStories();
    const savedStory = savedStories.find((story) => story.id === nextReaderStoryId);
    const officialClassicStory = classicStories.find((story) => story.id === nextReaderStoryId);
    const memoryStory = currentStory?.id === nextReaderStoryId ? currentStory : null;
    const storyForReader = officialClassicStory
      ? { ...officialClassicStory, favorite: savedStory?.favorite ?? officialClassicStory.favorite }
      : savedStory || memoryStory || null;
    currentStory = structuredClone(storyForReader);
    page = 'reader';
  } else if (activeReaderStoryId !== null) {
    cancelStoryAutoPlayback();
    stop();
    voiceState = 'idle';
    voiceAutoPlayback = false;
    voiceMessage = '';
    readerCoverImageUnavailableStoryId = null;
    currentStory = null;
    readerNotice = '';
  }
  if (readerCoverImageStoryId && readerCoverImageStoryId !== nextReaderStoryId) revokeReaderCoverImageUrl();
  activeReaderStoryId = nextReaderStoryId;
  const views = { home: homePage, create: createPage, library: libraryPage, mine: minePage, reader: readerPage };
  app.innerHTML = `${header()}${(views[page] || homePage)()}<footer class="site-footer"><span>✦ AI Story House｜AI 故事小屋</span><span>劉老師，陪你一起說故事</span></footer>`;
  restoreVisibleStoryCardImages();
  const coverImage = app.querySelector('[data-ai-cover-image]');
  if (coverImage) {
    coverImage.addEventListener('error', () => {
      const storyId = coverImage.dataset.aiCoverImage;
      if (currentStory?.id !== storyId || activeReaderStoryId !== storyId) return;
      readerCoverImageUnavailableStoryId = storyId;
      if (readerCoverImageStoryId === storyId) revokeReaderCoverImageUrl();
      render();
    }, { once: true });
  }
  if (page === 'reader' && currentStory?.type === 'ai') restoreReaderCoverImage(currentStory);
  document.querySelectorAll('.main-nav a').forEach((link) => link.classList.toggle('current', link.dataset.page === page));
}
window.addEventListener('pagehide', revokeStoryCardImageUrls);
function openStory(story, notice = '') { cancelStoryAutoPlayback(); stop(); voiceState = 'idle'; voiceAutoPlayback = false; voiceMessage = ''; if (currentStory?.id !== story.id) imageRequestMessage = ''; currentStory = structuredClone(story); readerNotice = notice; sceneIndex = 0; location.hash = `reader/${encodeURIComponent(story.id)}`; render(); }

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-page], [data-category], [data-read], [data-delete], [data-filter], [data-favorite], [data-scene], [data-scene-index], [data-voice], [data-narration], [data-story-autoplay], [data-rate], [data-character-choice], [data-character-custom], [data-story-idea], [data-image-test], [data-generate-story-image], .menu-toggle');
  if (!target) return;
  if (target.classList.contains('menu-toggle')) {
    const nav = document.querySelector('.main-nav'); const open = nav.classList.toggle('open'); target.setAttribute('aria-expanded', String(open)); return;
  }
  if (target.hasAttribute('data-character-choice')) {
    const characterInput = document.querySelector('#story-form [name="character"]');
    if (characterInput) {
      characterInput.value = target.dataset.characterChoice;
      characterInput.dispatchEvent(new Event('input', { bubbles: true }));
      characterInput.focus();
    }
    return;
  }
  if (target.hasAttribute('data-character-custom')) {
    document.querySelector('#story-form [name="character"]')?.focus();
    return;
  }
  if (target.hasAttribute('data-story-idea')) {
    const form = document.querySelector('#story-form');
    if (!form) return;
    const idea = createStoryIdea();
    lastStoryIdea = idea;

    const characterInput = form.querySelector('[name="character"]');
    characterInput.value = idea.protagonist;
    characterInput.dispatchEvent(new Event('input', { bubbles: true }));

    form.querySelectorAll('[name="personality"]').forEach((checkbox) => {
      checkbox.checked = idea.personalities.includes(checkbox.value);
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    for (const [name, value] of [['companion', idea.companion], ['setting', idea.setting], ['theme', idea.theme]]) {
      const input = form.querySelector(`[name="${name}"]`);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const ideaStatus = form.querySelector('#story-idea-status');
    ideaStatus.textContent = '✨ 已幫你想好一個故事設定，可以再修改喔！';
    ideaStatus.hidden = false;
    form.querySelector('#story-inspiration').hidden = false;
    updateStoryInspiration(form);
    return;
  }
  if (target.hasAttribute('data-image-test')) {
    if (!imageTestMode || !currentStory || imageTestBusy) return;
    const testStatus = document.querySelector('.image-test-status');
    if (testStatus) testStatus.textContent = '正在使用本機測試圖片驗證儲存流程……';
    runImageFixtureTest(currentStory);
    return;
  }
  if (target.hasAttribute('data-generate-story-image')) {
    const missingReadyImage = currentStory?.id && readerCoverImageUnavailableStoryId === currentStory.id;
    if (!currentStory || currentStory.type !== 'ai' || imageGenerationBusy || (currentStory.imageStatus === 'ready' && !missingReadyImage)) return;
    void runStoryImageGeneration(currentStory);
    return;
  }
  if (target.hasAttribute('data-narration')) {
    if (!isSpeechSynthesisSupported()) return;
    if (voiceState === 'speaking' || voiceState === 'paused') {
      stopReaderSpeech();
      render();
    } else {
      playCurrentScene({ advanceOnEnd: false });
    }
    return;
  }
  if (target.hasAttribute('data-story-autoplay')) {
    if (!isSpeechSynthesisSupported()) return;
    if (isStoryAutoPlaying) {
      stopReaderSpeech();
      render();
    } else {
      startStoryAutoPlayback();
    }
    return;
  }
  if (target.dataset.page) { if (target.dataset.page === 'library') libraryFilter = 'all'; location.hash = target.dataset.page; if (location.hash === `#${target.dataset.page}`) render(); return; }
  if (target.dataset.category) { libraryFilter = target.dataset.category; location.hash = 'library'; if (location.hash === '#library') render(); return; }
  if (target.dataset.read) {
    const source = target.dataset.source === 'classic' ? classicStories : getStories();
    const story = source.find((item) => item.id === target.dataset.read); if (story) openStory(story); return;
  }
  if (target.dataset.delete) { if (confirm('要刪除這個故事嗎？')) { deleteStory(target.dataset.delete); deleteStoryImage(target.dataset.delete).catch(() => {}); render(); } return; }
  if (target.dataset.filter) { libraryFilter = target.dataset.filter; render(); return; }
  if (target.dataset.voice) {
    if (target.dataset.voice === 'play') {
      if (isStoryAutoPlaying) return;
      playCurrentScene();
      return;
    }
    if (target.dataset.voice === 'pause') {
      if (pause()) { voiceState = 'paused'; voiceMessage = '朗讀已暫停。'; }
      render();
      return;
    }
    if (target.dataset.voice === 'resume') {
      if (resume()) { voiceState = 'speaking'; voiceMessage = '繼續朗讀目前這一幕。'; }
      render();
      return;
    }
    stopReaderSpeech();
    render();
    return;
  }
  if (target.dataset.rate) {
    voiceRate = Number(target.dataset.rate);
    render();
    return;
  }
  if (target.dataset.favorite) {
    const [updated] = toggleFavorite(target.dataset.favorite, currentStory).filter((story) => story.id === target.dataset.favorite);
    if (updated && currentStory) currentStory = updated; render(); return;
  }
  if (target.dataset.sceneIndex !== undefined) { stopReaderSpeech(); sceneIndex = Number(target.dataset.sceneIndex); render(); return; }
  if (target.dataset.scene) { stopReaderSpeech(); sceneIndex = Math.max(0, Math.min(currentStory.scenes.length - 1, sceneIndex + (target.dataset.scene === 'next' ? 1 : -1))); render(); }
});

document.addEventListener('input', (event) => {
  const form = event.target.form;
  if (event.target.name === 'character') {
    const selectedCharacter = event.target.value.trim();
    document.querySelectorAll('[data-character-choice]').forEach((button) => {
      const selected = button.dataset.characterChoice === selectedCharacter;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
  }
  if (['character', 'companion', 'setting', 'theme'].includes(event.target.name)) {
    updateStoryInspiration(form);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.name === 'personality') {
    updateStoryInspiration(event.target.form);
    return;
  }
  if (event.target.name === 'durationChoice') {
    const customDuration = document.querySelector('.custom-duration');
    const customInput = document.querySelector('#custom-story-duration');
    if (!customDuration || !customInput) return;
    const isCustom = event.target.value === 'custom';
    customDuration.hidden = !isCustom;
    customInput.required = isCustom;
    customInput.disabled = !isCustom;
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'story-form') return;
  event.preventDefault();
  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector('#story-form-status');
  const data = new FormData(form);
  const character = String(data.get('character') || '').trim();
  const companion = String(data.get('companion') || '').trim();
  const personalities = data.getAll('personality').map((value) => String(value).trim()).filter(Boolean);
  const characterForStory = personalities.length ? `${personalities.join('、')}的${character}` : character;
  const workerCharacters = [characterForStory, companion].filter(Boolean).join('與');
  const choice = data.get('durationChoice');
  const customMinutes = Number(data.get('customStoryDuration'));
  if (choice === 'custom' && (!Number.isInteger(customMinutes) || customMinutes < 1 || customMinutes > 30)) {
    status.textContent = '自訂故事時間請設定為 1 到 30 分鐘。';
    status.dataset.state = 'error';
    form.querySelector('#custom-story-duration').focus();
    return;
  }
  const duration = getStoryDurationSettings(choice, customMinutes);
  const options = {
    character: characterForStory,
    age: String(data.get('age') || ''),
    setting: String(data.get('setting') || '').trim(),
    theme: String(data.get('theme') || '').trim(),
    companion,
    style: String(data.get('style') || ''),
    storyDuration: duration.storyDuration,
    durationType: duration.durationType,
    durationLabel: duration.durationLabel,
    targetSceneCount: duration.targetSceneCount,
  };
  if (workerCharacters.length > 200) {
    status.textContent = '主角、個性與故事同伴合併後最多 200 字。請縮短文字後再試，原本輸入不會被更改。';
    status.dataset.state = 'error';
    form.querySelector('[name="companion"]').focus();
    return;
  }
  if (!options.setting) {
    status.textContent = '請輸入故事場景';
    status.dataset.state = 'error';
    form.querySelector('[name="setting"]').focus();
    return;
  }
  if (!options.theme) {
    status.textContent = '請輸入故事主題';
    status.dataset.state = 'error';
    form.querySelector('[name="theme"]').focus();
    return;
  }
  submitButton.disabled = true;
  submitButton.textContent = '正在為你創作…';
  status.textContent = '故事正在創作中，請稍候片刻。';
  status.dataset.state = 'loading';
  try {
    const generated = await generateStory(options);
    if (generated.storyDuration !== options.storyDuration) {
      throw new Error('故事服務回傳的長度與你的設定不一致，請重試。');
    }
    const story = {
      ...generated,
      characters: generated.characters,
      setting: options.setting,
      theme: options.theme,
      age: options.age,
      length: duration.durationLabel,
      storyDuration: options.storyDuration,
      options: {
        storyDuration: options.storyDuration,
        durationLabel: duration.durationLabel,
        targetSceneCount: duration.targetSceneCount,
      },
      style: options.style,
      favorite: false,
      coverImage: '',
      imageStatus: 'pending',
      scenes: generated.scenes.map((scene, index) => ({
        ...scene,
        id: scene.id || `scene-${index + 1}`,
        image: scene.image || '',
        audio: scene.audio || '',
      })),
    };
    let storageNotice = '';
    try {
      saveStory(story);
    } catch {
      storageNotice = '故事已產生，但目前無法儲存到瀏覽器。這次可以正常閱讀，但重新整理後可能會消失。';
    }
    openStory(story, storageNotice);
    // Story images remain pending until a provider is connected; text reading is immediate.
  } catch (error) {
    status.textContent = error.message || '故事創作暫時失敗，請稍後再試。';
    status.dataset.state = 'error';
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '✨ 開始創作故事';
  }
});
window.addEventListener('hashchange', render);
window.addEventListener('pagehide', () => {
  cancelStoryAutoPlayback();
  stop();
  revokeReaderCoverImageUrl();
});
render();
