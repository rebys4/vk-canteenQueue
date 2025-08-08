import React, { useEffect, useState } from 'react';
import { AppRoot, View, Panel, PanelHeader, Group, Button, Placeholder } from '@vkontakte/vkui';
import bridge from '@vkontakte/vk-bridge';

function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    bridge.send('VKWebAppInit').finally(() => setReady(true));
  }, []);

  return (
    <AppRoot>
      <View activePanel="home">
        <Panel id="home">
          <PanelHeader>Электронная очередь</PanelHeader>
          <Group>
            {ready ? (
              <Placeholder header="Готово к разработке">
                Подключим API и Supabase чуть позже
              </Placeholder>
            ) : (
              <Placeholder>Инициализация…</Placeholder>
            )}
          </Group>
          <Group>
            <Button size="l" stretched onClick={() => alert('Заглушка')}>Кнопка</Button>
          </Group>
        </Panel>
      </View>
    </AppRoot>
  );
}

export default App;
