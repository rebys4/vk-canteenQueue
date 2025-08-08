import React, { useEffect, useState, type JSX } from 'react';
import { Panel, PanelHeader, Group, SimpleCell, Header, ChipsInput, Footer, Spinner } from '@vkontakte/vkui';

type ProfileDto = {
  xp: number;
  badges: Array<{ awarded_at: string; badges: { id: string; code: string; title: string; description?: string | null } }>;
  visits: Array<{ canteen_id: string; joined_at: string; served_at?: string | null; left_at?: string | null }>;
};

const API = import.meta.env.VITE_API_URL!;

export default function ProfilePanel({ id }: { id: string }) : JSX.Element {
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/profile`, { credentials: 'omit' })
      .then((r) => r.json())
      .then(setProfile)
      .finally(() => setLoading(false));
  }, []);

  return (
    <Panel id={id}>
      <PanelHeader>Профиль</PanelHeader>

      {loading ? (
        <Group>
          <Spinner size="l" style={{ margin: 16 }} />
        </Group>
      ) : (
        <>
          <Group header={<Header>Опыт</Header>}>
            <SimpleCell>Ваш XP: {profile?.xp ?? 0}</SimpleCell>
          </Group>

          <Group header={<Header>Бейджи</Header>}>
            <ChipsInput
              value={(profile?.badges ?? []).map((b) => ({
                value: b.badges.id,
                label: b.badges.title,
              }))}
              readOnly
            />
          </Group>

          <Group header={<Header>История</Header>}>
            {(profile?.visits ?? []).slice(0, 30).map((v, i) => {
              const status = v.served_at ? 'обслужен' : v.left_at ? 'ушёл' : 'в очереди';
              const when = new Date(v.joined_at).toLocaleString();
              return (
                <SimpleCell key={i} subtitle={when}>
                  {status}
                </SimpleCell>
              );
            })}
            <Footer>Показаны последние {Math.min(30, profile?.visits?.length ?? 0)} визитов</Footer>
          </Group>
        </>
      )}
    </Panel>
  );
}
