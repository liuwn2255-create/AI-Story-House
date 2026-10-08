export const storyDurationOptions = [
  { value: '1', minutes: 1, icon: '⚡', title: '1 分鐘', description: '超短故事', scenes: { min: 3, max: 3 } },
  { value: '3', minutes: 3, icon: '🌱', title: '3 分鐘', description: '小故事', scenes: { min: 5, max: 5 } },
  { value: '5', minutes: 5, icon: '⭐', title: '5 分鐘', description: '標準故事', scenes: { min: 6, max: 8 } },
  { value: '10', minutes: 10, icon: '🌙', title: '10 分鐘', description: '完整冒險', scenes: { min: 10, max: 12 } },
  { value: '15', minutes: 15, icon: '📖', title: '15 分鐘', description: '長篇故事', scenes: { min: 12, max: 15 } },
];

export function getStoryDurationSettings(choice, customMinutes) {
  const selected = storyDurationOptions.find((option) => option.value === choice);
  const storyDuration = selected?.minutes ?? Number(customMinutes);
  let customScenes;
  if (storyDuration === 1) customScenes = { min: 3, max: 3 };
  else if (storyDuration === 2) customScenes = { min: 4, max: 5 };
  else if (storyDuration === 3) customScenes = { min: 5, max: 5 };
  else if (storyDuration <= 5) customScenes = { min: 6, max: 8 };
  else if (storyDuration <= 9) customScenes = { min: 8, max: 12 };
  else if (storyDuration === 10) customScenes = { min: 10, max: 12 };
  else if (storyDuration <= 15) customScenes = { min: 12, max: 15 };
  else customScenes = { min: 15, max: 24 };

  return {
    storyDuration,
    durationLabel: `${storyDuration} 分鐘`,
    durationType: selected ? 'preset' : 'custom',
    targetSceneCount: selected?.scenes ?? customScenes,
  };
}
