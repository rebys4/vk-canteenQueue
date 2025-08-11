import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  Panel, PanelHeader, Group, Button, SimpleCell, Placeholder, Select, Div,
  Separator, Spacing, View, Tabs, TabsItem, Skeleton
} from '@vkontakte/vkui';
import bridge from '@vkontakte/vk-bridge';
import { supabase } from './lib/supabase';
import { shareStory } from './lib/share';
import { apiRequest } from './api/client';
import Profile from './panels/Profile';

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

const PRESET_CANTEEN = import.meta.env.VITE_CANTEEN_ID || '';

export default function App(): JSX.Element {
  const [activePanel, setActivePanel] = useState<'home' | 'profile'>('home');

  const [vkId, setVkId] = useState<number | null>(null);
  const vkIdRef = useRef<number | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [canteenId, setCanteenId] = useState<string>(PRESET_CANTEEN);

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loadingRow, setLoadingRow] = useState(true);
  const [myRow, setMyRow] = useState<QueueRow | null>(null);
  const [names, setNames] = useState<DisplayNameMap>({});
  const [etaSec, setEtaSec] = useState(0);


  const [loadingJoin, setLoadingJoin] = useState(false);
  const [loadingLeave, setLoadingLeave] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);

  // --- VK ID ---
  useEffect(() => {
    (async () => {
      try {
        await bridge.send('VKWebAppInit');
        const u = await bridge.send('VKWebAppGetUserInfo');
        setVkId(u.id);
        setFirstName(u.first_name);
        setLastName(u.last_name);
      } catch {
        const devId = Number(import.meta.env.VITE_DEV_VK_ID);
        if (devId) setVkId(devId);
      }
    })();
  }, []);
  useEffect(() => { vkIdRef.current = vkId; }, [vkId]);

  // --- Profile / Admin flag ---
  useEffect(() => {
    if (!vkId) return;
    (async () => {
      try {
        const profile = await apiRequest('/api/profile');
        setIsAdmin(Boolean(profile?.isAdmin));
      } catch (e) {
        console.warn('load /api/profile failed', e);
      }
    })();
  }, [vkId]);

  // --- Load canteens ---
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

  // --- Queue ---
  const loadQueue = async (cid: string) => {
    setLoadingRow(true);
    const { data, error } = await supabase
      .from('queues')
      .select('*')
      .eq('canteen_id', cid)
      .in('status', ['waiting', 'served'])
      .order('position', { ascending: true });
    if (!error && data) setRows(data as QueueRow[]);
    setLoadingRow(false);
  };

  const isOpen = Boolean(canteens.find(c => c.id === canteenId)?.is_open);

  const waitingRows = useMemo(
    () => rows.filter(r => r.status === 'waiting').sort((a, b) => a.position - b.position),
    [rows]
  );

  function formatEta(sec: number) {
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setEtaSec(prev => prev + 1);
    }, 1000);
  
    return () => clearInterval(timer);
  }, [etaSec]);

  useEffect(() => {
    if (!canteenId) return;
    loadQueue(canteenId);

    const channel = supabase
      .channel(`queues:${canteenId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queues', filter: `canteen_id=eq.${canteenId}` },
        async (payload: any) => {
          await loadQueue(canteenId);

          try {
            if (payload?.eventType === 'UPDATE' && payload?.new) {
              const n = payload.new as QueueRow;
              if (n.status === 'served' && n.user_id === vkIdRef.current) {
                bridge.send('VKWebAppTapticNotificationOccurred', { type: 'success' }).catch(() => { });
              }
            }
          } catch { }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [canteenId]); // vkId берём из ref, чтобы не пересоздавать подписку

  // моя запись
  useEffect(() => {
    if (vkId == null) return;
    setMyRow(waitingRows.find(r => r.user_id === vkId) ?? null);
  }, [waitingRows, vkId]);

  // имена
  async function loadNamesFor(vkIds: number[]) {
    if (!vkIds.length) return;
    const { data } = await supabase
      .from('users_public')
      .select('vk_id, first_name, last_name')
      .in('vk_id', vkIds);
    const map: DisplayNameMap = {};
    (data ?? []).forEach(u => {
      const fn = u.first_name ?? 'Пользователь';
      const ln = (u.last_name?.[0] ?? '').toUpperCase();
      map[u.vk_id] = ln ? `${fn} ${ln}.` : fn;
    });
    setNames(prev => ({ ...prev, ...map }));
  }
  useEffect(() => {
    const ids = Array.from(new Set(rows.map(r => r.user_id)));
    const missing = ids.filter(id => !(id in names));
    if (missing.length) loadNamesFor(missing);
  }, [rows]);

  // позиция/ETA
  const position = useMemo(() => {
    if (!myRow) return null;
    const idx = waitingRows.findIndex(r => r.id === myRow.id);
    return idx >= 0 ? idx + 1 : null;
  }, [waitingRows, myRow]);

  useEffect(() => {
    (async () => {
      if (!canteenId) return setEtaSec(0);
      const ahead = position ? Math.max(0, position - 1) : 0;
      try {
        const { eta_seconds } = await apiRequest(`/api/eta?canteenId=${canteenId}&ahead=${ahead}`);
        setEtaSec(eta_seconds ?? 0);
      } catch {
        setEtaSec(0);
      }
    })();
  }, [canteenId, position]);

  // --- Actions ---
  const join = async () => {
    if (!canteenId) return;
    setLoadingJoin(true);
    try {
      await apiRequest('/api/queue/join', {
        method: 'POST',
        body: JSON.stringify({ canteenId, firstName, lastName }),
      });
      await loadQueue(canteenId);
    } catch (e: any) {} 
    finally {
      setLoadingJoin(false);
    }
  };

  const leave = async () => {
    if (!myRow) return;
    setLoadingLeave(true);
    try {
      await apiRequest('/api/queue/leave', {
        method: 'POST',
        body: JSON.stringify({ rowId: myRow.id }),
      });
      await loadQueue(canteenId);
    } catch {} finally {
      setLoadingLeave(false);
    }
  };

  const callNext = async () => {
    if (!isAdmin || !canteenId) return;
    setLoadingNext(true);
    try {
      await apiRequest('/api/admin/next', {
        method: 'POST',
        body: JSON.stringify({ canteenId }),
      });
      await loadQueue(canteenId);
    } catch (e: any) {} finally {
      setLoadingNext(false);
    }
  };

  const toggleOpen = async () => {
    if (!isAdmin || !canteenId) return;
    try {
      const nextOpen = !isOpen;
      await apiRequest('/api/admin/canteen/open', {
        method: 'POST',
        body: JSON.stringify({ canteenId, isOpen: nextOpen }),
      });
      const { data } = await supabase.from('canteens').select('*').order('title');
      if (data) setCanteens(data);
    } catch {}
  };

  return (
    <View activePanel={activePanel}>
      {/* HOME PANEL */}
      <Panel id="home">
        <PanelHeader>Электронная очередь в столовую</PanelHeader>
        <Group>
          <Tabs>
            <TabsItem selected={activePanel === 'home'} onClick={() => setActivePanel('home')}>Главная</TabsItem>
            <TabsItem selected={activePanel === 'profile'} onClick={() => setActivePanel('profile')}>Профиль</TabsItem>
          </Tabs>
        </Group>
        <Group>
          <Div>
            <Select
              value={canteenId}
              placeholder="Выберите столовую"
              onChange={(e) => setCanteenId(e.target.value)}
              options={canteens.map(c => ({ label: c.title, value: c.id }))}
            />
          </Div>
        </Group>
        <Group>
          {loadingRow ? (
            <>
              <Skeleton height={40} style={{ marginBottom: 8 }} />
              <Skeleton height={40} style={{ marginBottom: 8 }} />
              <Skeleton height={40} />
            </>
          ) : waitingRows.length === 0 ? (
            <Placeholder>Очередь пуста</Placeholder>
          ) : (
            waitingRows.map((r, i) => (
              <SimpleCell key={r.id} subtitle={r.user_id === vkId ? 'Это вы' : undefined}>
                {`#${i + 1} · ${names[r.user_id] ?? '...'}`}
              </SimpleCell>
            ))
          )}
        </Group>
        <Group>
          <SimpleCell indicator={isOpen ? 'Открыто' : 'На паузе'}>Статус окна</SimpleCell>
        </Group>
        <Group>
          {myRow
            ? <>
              <SimpleCell>{`Ваша позиция: ${position ?? '—'}, время в очереди: ${formatEta(etaSec)} мин`}</SimpleCell>
              <Button size="l" stretched onClick={leave} disabled={loadingLeave} loading={loadingLeave}>Выйти из очереди</Button>
            </>
            : <Button size="l" stretched disabled={!canteenId || !isOpen || loadingJoin} loading={loadingJoin} onClick={join}>
              {isOpen ? 'Встать в очередь' : 'Окно на паузе'}
            </Button>}
        </Group>
        <Group>
          <Button size="l" stretched mode="secondary" onClick={() => shareStory(etaSec / 60)}>Поделиться в Stories</Button>
        </Group>
        {isAdmin && (
          <>
            <SimpleCell><b>Админ-панель</b></SimpleCell>
            <Spacing size={8} /><Separator /><Spacing size={8} />
            <Group>
              <Button size="l" stretched onClick={callNext} disabled={loadingNext} loading={loadingNext}>Позвать следующего человека</Button>
              <Spacing size={8} />
              <Button size="l" stretched mode={isOpen ? 'secondary' : 'primary'} onClick={toggleOpen}>
                {isOpen ? 'Поставить на паузу' : 'Открыть окно'}
              </Button>
            </Group>
          </>
        )}
      </Panel>

      {/* PROFILE PANEL */}
      <Panel id="profile">
        <PanelHeader>Профиль</PanelHeader>
        <Group>
          <Tabs>
            <TabsItem selected={activePanel === 'home'} onClick={() => setActivePanel('home')}>Главная</TabsItem>
            <TabsItem selected={activePanel === 'profile'} onClick={() => setActivePanel('profile')}>Профиль</TabsItem>
          </Tabs>
        </Group>
        <Profile />
      </Panel>
    </View>
  );
}