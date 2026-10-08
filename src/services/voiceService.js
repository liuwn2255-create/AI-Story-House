/** 語音服務預留介面，目前不連接語音供應商。 */
export function playScene(scene) {
  void scene;
  return Promise.reject(new Error('語音朗讀功能尚未啟用。'));
}

export function pause() {}
