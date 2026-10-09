const DATABASE_NAME = 'ai-story-house-image-storage';
const DATABASE_VERSION = 1;
const STORE_NAME = 'story-images';

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('此瀏覽器目前無法使用 IndexedDB。'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'storyId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('無法開啟故事圖片資料庫。'));
    request.onblocked = () => reject(new Error('故事圖片資料庫正在更新，請重新載入頁面。'));
  });
}

async function runRequest(mode, createRequest) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = createRequest(transaction.objectStore(STORE_NAME));
    let result;

    request.onsuccess = () => { result = request.result; };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error('故事圖片資料操作失敗。'));
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('故事圖片資料交易失敗。'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('故事圖片資料交易已取消。'));
    };
  });
}

/** Stores the binary image in IndexedDB; image bytes never enter localStorage. */
export function saveStoryImage(storyId, blob) {
  if (typeof storyId !== 'string' || !storyId.trim() || !(blob instanceof Blob)) {
    return Promise.reject(new TypeError('請提供有效的故事編號與圖片 Blob。'));
  }
  if (!blob.type.startsWith('image/')) {
    return Promise.reject(new TypeError('故事圖片必須是有效的圖片 Blob。'));
  }
  return runRequest('readwrite', (store) => store.put({ storyId, blob, mimeType: blob.type, savedAt: Date.now() }));
}

/** Returns the stored Blob, or null when no image has been saved for this story. */
export async function getStoryImage(storyId) {
  if (typeof storyId !== 'string' || !storyId.trim()) return null;
  const record = await runRequest('readonly', (store) => store.get(storyId));
  return record?.blob instanceof Blob ? record.blob : null;
}

export function deleteStoryImage(storyId) {
  if (typeof storyId !== 'string' || !storyId.trim()) {
    return Promise.reject(new TypeError('請提供有效的故事編號。'));
  }
  return runRequest('readwrite', (store) => store.delete(storyId));
}
