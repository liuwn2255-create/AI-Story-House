let activeUtterance = null;
let activeToken = 0;

export function isSpeechSynthesisSupported() {
  return typeof window !== 'undefined'
    && typeof window.speechSynthesis !== 'undefined'
    && typeof window.SpeechSynthesisUtterance === 'function';
}

function getChineseVoice() {
  if (!isSpeechSynthesisSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  const score = (voice) => {
    const lang = voice.lang.toLowerCase().replaceAll('_', '-');
    if (/^zh-(tw|hant)(-|$)/.test(lang)) return 4;
    if (/^zh-(hk|mo)(-|$)/.test(lang)) return 3;
    if (lang.startsWith('zh-')) return 2;
    if (lang === 'zh') return 1;
    return 0;
  };
  return voices
    .filter((voice) => score(voice) > 0)
    .sort((a, b) => score(b) - score(a))[0] || null;
}

export function getVoiceDescription() {
  const voice = getChineseVoice();
  if (!voice) return '使用系統預設語音';
  const lang = voice.lang.toLowerCase().replaceAll('_', '-');
  return /^zh-(tw|hant)(-|$)/.test(lang) ? '台灣中文語音' : '中文語音';
}

export function playScene(scene, { rate = 0.9, onEnd, onError } = {}) {
  if (!isSpeechSynthesisSupported()) {
    throw new Error('這個瀏覽器不支援語音朗讀，仍可照常閱讀故事。');
  }
  if (typeof scene?.text !== 'string' || !scene.text.trim()) {
    throw new Error('這一幕沒有可朗讀的文字。');
  }

  stop();
  const token = activeToken;
  const utterance = new window.SpeechSynthesisUtterance(scene.text);
  const voice = getChineseVoice();
  utterance.lang = voice?.lang || 'zh-TW';
  if (voice) utterance.voice = voice;
  utterance.rate = Math.min(1.1, Math.max(0.7, Number(rate) || 0.9));
  utterance.onend = () => {
    if (token !== activeToken) return;
    activeUtterance = null;
    onEnd?.();
  };
  utterance.onerror = (event) => {
    if (token !== activeToken || event?.error === 'canceled' || event?.error === 'interrupted') return;
    activeUtterance = null;
    onError?.(new Error('語音播放遇到問題，請再試一次。'));
  };

  activeUtterance = utterance;
  window.speechSynthesis.speak(utterance);
  return { voice: voice?.name || null, voiceDescription: getVoiceDescription() };
}

export function pause() {
  if (!isSpeechSynthesisSupported() || !activeUtterance) return false;
  try {
    window.speechSynthesis.pause();
    return true;
  } catch {
    return false;
  }
}

export function resume() {
  if (!isSpeechSynthesisSupported() || !activeUtterance) return false;
  try {
    window.speechSynthesis.resume();
    return true;
  } catch {
    return false;
  }
}

export function stop() {
  activeToken += 1;
  activeUtterance = null;
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Reading remains available even if the browser speech engine cannot cancel.
  }
}
