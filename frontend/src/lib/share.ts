import bridge from '@vkontakte/vk-bridge';

/**
 * Шарит простую сториз с текстовым стикером.
 * В типах vk-bridge допустимы background_type: 'image' | 'video' | 'none'
 * Стикеры передаются массивом в поле stickers.
 */
export async function shareStory(savedMinutes: number) {
  const minutes = Math.max(0, Math.round(savedMinutes));

  const params = {
    background_type: 'none' as const,
    stickers: [
      {
        sticker_type: 'renderable' as const,
        sticker: {
          type: 'text' as const,
          text: `Сэкономил ${minutes} мин в очереди 🕒`,
          style: 'white' as const
        }
      }
    ]
  };

  try {
    await bridge.send('VKWebAppShowStoryBox', params as any); // cast на случай несовпадения минорных типов
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Story share not available in this env', e);
  }
}
