import React, { useEffect, useMemo, useState } from 'react';
import {
  AppRoot,
  View,
  Panel,
  PanelHeader,
  Group,
  Button,
  SimpleCell,
  Placeholder,
  Select,
  Div,
  Tabbar,
  TabbarItem,
  Separator,
  Spacing,
  SplitLayout,
  SplitCol,
} from '@vkontakte/vkui';
import bridge from '@vkontakte/vk-bridge';
import { supabase } from './lib/supabase';
import { withVkParams } from './api/fetchWithVk';
import ProfilePanel from './panels/Profile';
import { shareStory } from './lib/share';

type Canteen = { id: string; title: string; is_open: boolean };
type QueueRow = {
  id: string;
  canteen_id: string;
  user_id: number;
  joined_at: string;
  status: 'waiting' | 'served' | 'left';
  position: number;
};
type DisplayNameMap = Record<number, string>;

const API = import.meta.env.VITE_API_URL!;
const PRESET_CANTEEN = import.meta.env.VITE_CANTEEN_ID || '';
const ADMIN_IDS = (import.meta.env.VITE_ADMINS || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter(Boolean);

export default function App() {
  const [active, setActive] = useState<'home' | 'profile'>('home');

  const [vkId, setVkId] = useState<number | null>(null);
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);

  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [canteenId, setCanteenId] = useState<string>(PRESET_CANTEEN);

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [myRow, setMyRow] = useState<QueueRow | null>(null);
  const [names, setNames] = useState<DisplayNameMap>({});

  useEffect(() => {
    bridge.send('VKWebAppInit');
    bridge.send('VKWebAppGetUserInfo').then((u) => {
      setVkId(u.id);
      setFirstName(u.first_name);
      setLastName(u.last_name);
      setIsAdmin(ADMIN_IDS.includes(u.id));
    });
  }, []);

  // столовые
  useEffect(() => {
    supabase
      .from('canteens')
      .select('*')
      .order('title')
      .then(({ data }) => {
        if (data) {
          setCanteens(data);
          if (!canteenId && data[0]) setCanteenId(data[0].id);
        }
      });
  }, []);

  // загрузка очереди
  const loadQueue = async (cid: string) => {
    const { data, error } = await supabase
      .from('queues')
      .select('*')
      .eq('canteen_id', cid)
      .in('status', ['waiting', 'served'])
      .order('position', { ascending: true });
    if (!error && data) setRows(data as QueueRow[]);
  };

  // Realtime подписка
  useEffect(() => {
    if (!canteenId) return;
    loadQueue(canteenId);
    const channel = supabase
      .channel(`queues:${canteenId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queues', filter: `canteen_id=eq.${canteenId}` },
        () => loadQueue(canteenId),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [canteenId]);

  useEffect(() => {
    (async () => {
      try {
        await bridge.send('VKWebAppInit');
        const u = await bridge.send('VKWebAppGetUserInfo');
        setVkId(u.id);
        setFirstName(u.first_name);
        setLastName(u.last_name);
        setIsAdmin(ADMIN_IDS.includes(u.id));
      } catch (e) {
        const devId = Number(import.meta.env.VITE_DEV_VK_ID);
        if (devId) {
          setVkId(devId);
          setIsAdmin(ADMIN_IDS.includes(devId));
        }
      }
    })();
  }, []);

  // моя запись
  useEffect(() => {
    if (vkId == null) return;
    setMyRow(rows.find((r) => r.user_id === vkId && r.status === 'waiting') ?? null);
  }, [rows, vkId]);

  // имена для анонимизации
  async function loadNamesFor(vkIds: number[]) {
    if (!vkIds.length) return;
    const { data } = await supabase
      .from('users_public')
      .select('vk_id, first_name, last_name')
      .in('vk_id', vkIds);
    const map: DisplayNameMap = {};
    (data ?? []).forEach((u) => {
      const fn = u.first_name ?? 'Пользователь';
      const ln = (u.last_name?.[0] ?? '').toUpperCase();
      map[u.vk_id] = ln ? `${fn} ${ln}.` : fn;
    });
    setNames((prev) => ({ ...prev, ...map }));
  }

  useEffect(() => {
    const ids = Array.from(new Set(rows.map((r) => r.user_id)));
    const missing = ids.filter((id) => !(id in names));
    if (missing.length) loadNamesFor(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const position = useMemo(() => {
    if (!myRow) return null;
    const idx = rows.findIndex((r) => r.id === myRow.id);
    return idx >= 0 ? idx + 1 : null;
  }, [rows, myRow]);

  const etaMinutes = position ? (position - 1) * 0.5 : 0; // ~30 сек/чел

  const join = async () => {
    if (!canteenId) return;
    await fetch(`${API}/api/queue/join`, withVkParams({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canteenId, firstName, lastName })
    }));
    await loadQueue(canteenId); // <—
  };

  const leave = async () => {
    if (!myRow) return;
    await fetch(`${API}/api/queue/leave`, withVkParams({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId: myRow.id })
    }));
    await loadQueue(canteenId); // <—
  };

  const callNext = async () => {
    if (!isAdmin || !canteenId || !vkId) return;
    await fetch(
      `${API}/api/admin/next`,
      withVkParams({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canteenId }),
      }),
    );
  };

  return (
    <AppRoot>
      <SplitLayout>
        <SplitCol>
          <View
            activePanel={active}
            tabbar={
              <Tabbar>
                <TabbarItem selected={active === 'home'} onClick={() => setActive('home')}>
                  Главная
                </TabbarItem>
                <TabbarItem selected={active === 'profile'} onClick={() => setActive('profile')}>
                  Профиль
                </TabbarItem>
              </Tabbar>
            }
          >
            {/* HOME */}
            <Panel id="home">
              <PanelHeader>Электронная очередь</PanelHeader>

              <Group>
                <Div>
                  <Select
                    value={canteenId}
                    placeholder="Выберите столовую"
                    onChange={(e) => setCanteenId(e.target.value)}
                    options={canteens.map((c) => ({ label: c.title, value: c.id }))}
                  />
                </Div>
                <Div style={{ opacity: 0.6, fontSize: 12 }}>
                  vkId: {String(vkId)} · canteenId: {canteenId || '—'} · rows: {rows.length}
                </Div>

              </Group>

              <Group>
                {rows.length === 0 ? (
                  <Placeholder>Очередь пуста</Placeholder>
                ) : (
                  rows.map((r, i) => (
                    <SimpleCell key={r.id} subtitle={r.user_id === vkId ? 'Это вы' : undefined}>
                      {`#${i + 1} · ${names[r.user_id] ?? '...'}`}
                    </SimpleCell>
                  ))
                )}
              </Group>

              <Group>
                {myRow ? (
                  <>
                    <SimpleCell>
                      {`Ваша позиция: ${position ?? '—'} · ETA ≈ ${etaMinutes.toFixed(1)} мин`}
                    </SimpleCell>
                    <Button size="l" stretched onClick={leave}>
                      Выйти из очереди
                    </Button>
                  </>
                ) : (
                  <Button size="l" stretched disabled={!canteenId} onClick={join}>
                    Встать в очередь
                  </Button>
                )}
              </Group>

              {isAdmin && (
                <>
                  <Spacing size={8} />
                  <Separator />
                  <Spacing size={8} />
                  <Group>
                    <Button size="l" stretched onClick={callNext}>
                      Позвать следующего (админ)
                    </Button>
                  </Group>
                </>
              )}

              <Group>
                <Button size="l" stretched mode="secondary" onClick={() => shareStory(etaMinutes)}>
                  Поделиться в Stories
                </Button>
              </Group>
            </Panel>

            {/* PROFILE */}
            <ProfilePanel id="profile" />
          </View>
        </SplitCol>
      </SplitLayout>
    </AppRoot>
  );
}