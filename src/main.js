import './styles/main.css';
import './styles/storyDuration.css';
import storytellerAvatar from './assets/storyteller-avatar.png';
import { classicStories } from './data/classicStories.js';
import { getStoryDurationSettings, storyDurationOptions } from './data/storyDurationOptions.js';
import { generateStory } from './services/aiStoryService.js';
import { deleteStory, getStories, saveStory, toggleFavorite } from './services/storyStorage.js';

const app = document.querySelector('#app');
let currentStory = null;
let sceneIndex = 0;
let libraryFilter = 'all';

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
function storyCard(story, actionLabel = '開始閱讀') {
  return `<article class="story-card"><div class="story-card-art ${story.type === 'classic' ? 'classic-art' : ''}">${story.type === 'classic' ? '🌙' : '✨'}</div><div class="story-card-body"><span class="eyebrow">${story.type === 'classic' ? '經典故事' : 'AI 故事'}</span><h3>${escapeHtml(story.title)}</h3><p>${escapeHtml(story.theme || '一段奇妙的故事')} · ${story.scenes?.length ?? 0} 個場景</p><div class="card-actions"><button class="text-button" data-read="${story.id}" data-source="${story.type}">${actionLabel} →</button>${story.type !== 'classic' ? `<button class="icon-button" title="刪除故事" aria-label="刪除故事" data-delete="${story.id}">⌫</button>` : ''}</div></div></article>`;
}
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function homePage() {
  const saved = getStories();
  return `<main><section class="hero"><div class="hero-copy"><span class="eyebrow">WELCOME TO OUR STORY HOUSE</span><h1>每一個故事，<br /><em>都是一場小小冒險。</em></h1><p>在想像力的小屋裡，讓我們一起翻開故事的第一頁。</p>${storyteller()}<button class="button button-primary" data-page="create">✨ 開始 AI 創作故事</button></div><div class="hero-art"><div class="sun-orb"></div><div class="book-illustration"><span class="book-star">✦</span><span class="book-title">很久很久<br />以前⋯⋯</span><span class="book-flower">✿</span></div><span class="float-note note-one">✧</span><span class="float-note note-two">✦</span><div class="art-caption">你的下一個故事，從這裡開始</div></div></section><section class="section-block"><div class="section-heading"><div><span class="eyebrow">EXPLORE</span><h2>故事小屋裡有什麼？</h2></div><a href="#library" data-page="library" class="subtle-link">逛逛故事書架 →</a></div><div class="feature-grid"><button class="feature-tile" data-page="create"><span class="feature-icon peach">✍️</span><strong>AI 故事創作</strong><span>把你的想法變成故事</span></button><button class="feature-tile" data-page="library"><span class="feature-icon blue">📚</span><strong>故事書架</strong><span>探索不同的故事世界</span></button><button class="feature-tile" data-page="mine"><span class="feature-icon yellow">⭐</span><strong>我的故事</strong><span>收藏屬於你的回憶</span></button></div></section>${saved.length ? `<section class="section-block"><div class="section-heading"><div><span class="eyebrow">YOUR STORIES</span><h2>最近的故事</h2></div><a href="#mine" data-page="mine" class="subtle-link">查看全部 →</a></div><div class="story-grid">${saved.slice(0, 3).map((story) => storyCard(story)).join('')}</div></section>` : ''}</main>`;
}
function createPage() {
  const durationCards = storyDurationOptions.map((option) => `<label class="duration-card"><input type="radio" name="durationChoice" value="${option.value}" ${option.value === '5' ? 'checked' : ''} /><span class="duration-card-content"><span class="duration-icon">${option.icon}</span><strong>${option.title}</strong><span>${option.description}</span><small>約 ${option.scenes.min}${option.scenes.max !== option.scenes.min ? `～${option.scenes.max}` : ''} 個場景</small></span></label>`).join('');
  return `<main class="page-shell"><div class="page-intro"><span class="eyebrow">MAKE A LITTLE MAGIC</span><h1>來編一個故事吧</h1><p>選擇你喜歡的元素，故事就從想像開始。</p></div><div class="form-layout"><form class="story-form" id="story-form"><label>故事主角<input name="character" placeholder="例如：勇敢的小兔子" required maxlength="100" /></label><div class="form-row"><label>年齡<select name="age"><option>3–5 歲</option><option selected>6–8 歲</option><option>9–12 歲</option><option>親子共讀</option></select></label><label>故事風格<select name="style"><option>溫暖療癒</option><option>奇幻冒險</option><option>幽默有趣</option><option>睡前晚安</option></select></label></div><fieldset class="duration-fieldset"><legend>故事長度</legend><div class="duration-grid">${durationCards}<label class="duration-card"><input type="radio" name="durationChoice" value="custom" /><span class="duration-card-content"><span class="duration-icon">⏱️</span><strong>自訂時間</strong><span>由你決定長度</span><small>依時間建議場景數</small></span></label></div><div class="custom-duration" hidden><label for="custom-story-duration">自訂分鐘數</label><div class="custom-duration-input"><input id="custom-story-duration" name="customStoryDuration" type="number" min="1" max="30" step="1" value="5" disabled /><span>分鐘</span></div></div></fieldset><label>故事場景<input name="setting" placeholder="例如：雲朵上的秘密花園" maxlength="160" /></label><label>故事主題<input name="theme" placeholder="例如：勇氣、分享、探索" maxlength="120" /></label><label>故事同伴<input name="companion" placeholder="例如：會說話的小狐狸" maxlength="100" /></label><button class="button button-primary full-button" type="submit">✨ 開始創作故事</button><p class="form-note" id="story-form-status" role="status" aria-live="polite">將依照你的設定創作一則專屬故事。</p></form><aside class="form-aside"><div class="aside-doodle">✦</div>${storyteller()}<h3>想像力沒有標準答案</h3><p>主角可以是任何人，場景也可以在任何地方。準備好就開始吧！</p></aside></div></main>`;
}
function libraryPage() {
  const filters = [['all', '全部故事'], ['ai', '🤖 AI 故事'], ['classic', '📚 經典故事'], ['favorite', '⭐ 我的收藏'], ['ray', '🧒 Ray & Tracy']];
  const savedStories = getStories();
  let stories = [...classicStories.filter((story) => !savedStories.some((saved) => saved.id === story.id)), ...savedStories];
  if (libraryFilter === 'ai') stories = stories.filter((story) => story.type === 'ai');
  if (libraryFilter === 'classic') stories = stories.filter((story) => story.type === 'classic');
  if (libraryFilter === 'favorite') stories = stories.filter((story) => story.favorite);
  if (libraryFilter === 'ray') stories = stories.filter((story) => story.characters?.some((name) => /ray|tracy/i.test(name)));
  return `<main class="page-shell"><div class="page-intro"><span class="eyebrow">STORY LIBRARY</span><h1>故事書架</h1><p>挑一本喜歡的故事，找個舒服的位置，一起讀下去。</p></div><div class="filter-row">${filters.map(([id, label]) => `<button class="filter-chip ${libraryFilter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`).join('')}</div><div class="story-grid">${stories.length ? stories.map((story) => storyCard(story)).join('') : `<div class="empty-state"><span>📖</span><h3>這個書格還空著</h3><p>喜歡的故事會在這裡等你。</p></div>`}</div></main>`;
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
  const sceneImage = typeof scene.image === 'string' && scene.image.trim()
    ? `<div class="reader-scene-visual"><img class="reader-scene-image" src="${escapeHtml(scene.image)}" alt="${escapeHtml(currentStory.title)}：${escapeHtml(scene.title)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><div class="reader-image-placeholder" hidden><span aria-hidden="true">🌿 ✦ 🌼</span><strong>故事畫面</strong><small>這一幕的插畫暫時無法顯示</small></div></div>`
    : `<div class="reader-scene-visual"><div class="reader-image-placeholder" role="img" aria-label="${escapeHtml(scene.title)}的故事畫面預留位置"><span aria-hidden="true">🌿 ✦ 🌼</span><strong>故事畫面</strong><small>想像力正在描繪這一幕</small></div></div>`;
  const durationSummary = currentStory.options ? `<p class="reader-duration">⏱ ${escapeHtml(currentStory.options.durationLabel)} · 預計 ${currentStory.options.targetSceneCount.min}${currentStory.options.targetSceneCount.max !== currentStory.options.targetSceneCount.min ? `～${currentStory.options.targetSceneCount.max}` : ''} 個場景</p>` : '';
  return `<main class="reader-shell"><div class="reader-top"><button class="text-button" data-page="library">← 回到故事書架</button><button class="favorite-button ${currentStory.favorite ? 'is-favorite' : ''}" data-favorite="${currentStory.id}">${currentStory.favorite ? '★ 已收藏' : '☆ 收藏故事'}</button></div><article class="reader-card"><div class="reader-heading"><span class="eyebrow">${currentStory.type === 'classic' ? '經典故事' : 'AI 故事'}</span><h1>${escapeHtml(currentStory.title)}</h1>${durationSummary}${storyteller(true)}</div>${sceneImage}<div class="reader-scene"><div class="scene-number">SCENE ${String(sceneIndex + 1).padStart(2, '0')} / ${String(currentStory.scenes.length).padStart(2, '0')}</div><h2>${escapeHtml(scene.title)}</h2><p>${escapeHtml(scene.text)}</p></div><div class="reader-controls"><button class="button button-secondary" data-scene="prev" ${sceneIndex === 0 ? 'disabled' : ''}>← 上一幕</button><div class="scene-dots">${currentStory.scenes.map((_, i) => `<button aria-label="第 ${i + 1} 幕" class="scene-dot ${i === sceneIndex ? 'active' : ''}" data-scene-index="${i}"></button>`).join('')}</div><button class="button button-secondary" data-scene="next" ${sceneIndex === currentStory.scenes.length - 1 ? 'disabled' : ''}>下一幕 →</button></div><div class="voice-placeholder">${storyteller(true)}<span class="voice-status">語音朗讀功能準備中</span><button disabled>▶ 播放語音</button><button disabled>Ⅱ 暫停</button></div></article></main>`;
}
function render() {
  let page = location.hash.slice(1) || 'home';
  if (page.startsWith('reader/')) {
    const storyId = decodeURIComponent(page.slice('reader/'.length));
    currentStory = structuredClone([...getStories(), ...classicStories].find((story) => story.id === storyId) || null);
    page = 'reader';
  }
  const views = { home: homePage, create: createPage, library: libraryPage, mine: minePage, reader: readerPage };
  app.innerHTML = `${header()}${(views[page] || homePage)()}<footer class="site-footer"><span>✦ AI Story House｜AI 故事小屋</span><span>劉老師，陪你一起說故事</span></footer>`;
  document.querySelectorAll('.main-nav a').forEach((link) => link.classList.toggle('current', link.dataset.page === page));
}
function openStory(story) { currentStory = structuredClone(story); sceneIndex = 0; location.hash = `reader/${encodeURIComponent(story.id)}`; render(); }

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-page], [data-read], [data-delete], [data-filter], [data-favorite], [data-scene], [data-scene-index], .menu-toggle');
  if (!target) return;
  if (target.classList.contains('menu-toggle')) {
    const nav = document.querySelector('.main-nav'); const open = nav.classList.toggle('open'); target.setAttribute('aria-expanded', String(open)); return;
  }
  if (target.dataset.page) { if (target.dataset.page === 'library') libraryFilter = 'all'; location.hash = target.dataset.page; if (location.hash === `#${target.dataset.page}`) render(); return; }
  if (target.dataset.read) {
    const source = target.dataset.source === 'classic' ? classicStories : getStories();
    const story = source.find((item) => item.id === target.dataset.read); if (story) openStory(story); return;
  }
  if (target.dataset.delete) { if (confirm('要刪除這個故事嗎？')) { deleteStory(target.dataset.delete); render(); } return; }
  if (target.dataset.filter) { libraryFilter = target.dataset.filter; render(); return; }
  if (target.dataset.favorite) {
    const [updated] = toggleFavorite(target.dataset.favorite, currentStory).filter((story) => story.id === target.dataset.favorite);
    if (updated && currentStory) currentStory = updated; render(); return;
  }
  if (target.dataset.sceneIndex !== undefined) { sceneIndex = Number(target.dataset.sceneIndex); render(); return; }
  if (target.dataset.scene) { sceneIndex = Math.max(0, Math.min(currentStory.scenes.length - 1, sceneIndex + (target.dataset.scene === 'next' ? 1 : -1))); render(); }
});

document.addEventListener('change', (event) => {
  if (event.target.name !== 'durationChoice') return;
  const customDuration = document.querySelector('.custom-duration');
  const customInput = document.querySelector('#custom-story-duration');
  if (!customDuration || !customInput) return;
  const isCustom = event.target.value === 'custom';
  customDuration.hidden = !isCustom;
  customInput.required = isCustom;
  customInput.disabled = !isCustom;
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'story-form') return;
  event.preventDefault();
  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector('#story-form-status');
  const data = new FormData(form);
  const character = String(data.get('character') || '').trim();
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
    character,
    age: String(data.get('age') || ''),
    setting: String(data.get('setting') || '').trim(),
    theme: String(data.get('theme') || '').trim(),
    companion: String(data.get('companion') || '').trim(),
    style: String(data.get('style') || ''),
    storyDuration: duration.storyDuration,
    durationType: duration.durationType,
    durationLabel: duration.durationLabel,
    targetSceneCount: duration.targetSceneCount,
  };
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
      characters: [character, options.companion].filter(Boolean),
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
      scenes: generated.scenes.map((scene, index) => ({
        ...scene,
        id: scene.id || `scene-${index + 1}`,
        image: scene.image || '',
        audio: scene.audio || '',
      })),
    };
    saveStory(story);
    openStory(story);
  } catch (error) {
    status.textContent = error.message || '故事創作暫時失敗，請稍後再試。';
    status.dataset.state = 'error';
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '✨ 開始創作故事';
  }
});
window.addEventListener('hashchange', render);
render();
