import React, { useEffect, useMemo, useState } from 'react';
import {
  Group,
  Header,
  SimpleCell,
  Footer,
  Spinner,
  Placeholder,
  Progress,
  Button,
  Card,
  CardGrid,
  MiniInfoCell,
  Caption,
  Div,
} from '@vkontakte/vkui';
import {
  Icon20CheckCircleFillGreen,
  Icon20CancelCircleFillRed,
  Icon20ClockOutline,
  Icon20FavoriteCircleFillYellow,
} from '@vkontakte/icons';
import { apiRequest } from '../api/client';


type BadgeInfo = {
  id: string;
  code: string;
  title: string;
  description?: string | null;
};

type BadgeItem = {
  awarded_at: string;
  badges: BadgeInfo;
};

type Visit = {
  canteen_id: string;
  joined_at: string;
  served_at?: string | null;
  left_at?: string | null;
};

type ProfileDto = {
  xp: number;
  badges: BadgeItem[];
  visits: Visit[];
};

type QuestDto = {
  code: string;
  title: string;
  description?: string | null;
  xp: number;
  completed: boolean;
};

const PAGE_SIZE = 5;

// форматтеры
function formatDate(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function statusOf(v: Visit): { label: string; icon: React.ReactNode } {
  if (v.served_at) {
    return { label: 'Обслужен', icon: <Icon20CheckCircleFillGreen /> };
  }
  if (v.left_at) {
    return { label: 'Ушёл', icon: <Icon20CancelCircleFillRed /> };
  }
  return { label: 'В очереди', icon: <Icon20ClockOutline /> };
}

export default function Profile(): React.ReactElement {
  const [data, setData] = useState<ProfileDto | null>(null);
  const [quests, setQuests] = useState<QuestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // загрузка профиля
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await apiRequest('/api/profile');
        if (!aborted) setData(res);
      } catch (e: any) {
        if (!aborted) setError(e?.message ?? 'Failed to load profile');
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  // квесты на сегодня
  useEffect(() => {
    (async () => {
      try {
        const q = await apiRequest('/api/quests/today');
        setQuests(q);
      } catch {
        /* no-op */
      }
    })();
  }, []);

  const xp = data?.xp ?? 0;
  const level = useMemo(() => {
    // простая система: каждые 100 XP — новый левел
    const lvl = Math.floor(xp / 100) + 1;
    const curStart = (lvl - 1) * 100;
    const curProgress = Math.min(100, Math.max(0, xp - curStart));
    return { lvl, curProgress };
  }, [xp]);

  if (loading) {
    return (
      <Group>
        <Spinner size="l" style={{ margin: 16 }} />
      </Group>
    );
  }

  if (error) {
    return (
      <Group>
        <Placeholder>
          Не удалось загрузить профиль: {error}
        </Placeholder>
      </Group>
    );
  }

  return (
    <>
      {/* Шапка профиля: уровень, XP и прогресс */}
      <Group header={<Header>Профиль</Header>}>
        <Div>
          <MiniInfoCell before={<Icon20FavoriteCircleFillYellow />} textWrap="short">
            Уровень: <b>{level.lvl}</b>
          </MiniInfoCell>
          <MiniInfoCell before={<Icon20FavoriteCircleFillYellow />} textWrap="short">
            Опыт: <b>{xp}</b> XP
          </MiniInfoCell>
          <Caption level="2" style={{ margin: '8px 0 4px' }}>
            Прогресс до следующего уровня
          </Caption>
          <Progress value={level.curProgress} />
        </Div>
      </Group>

      {/* Ежедневные квесты */}
      <Group header={<Header>Ежедневные квесты</Header>}>
        {quests.length === 0 ? (
          <Placeholder>Сегодня квестов нет</Placeholder>
        ) : (
          <CardGrid size="l">
            {quests.map((q) => (
              <Card key={q.code} style={{ padding: 12 }}>
                <Div style={{ padding: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{q.title}</div>
                      {q.description && (
                        <Caption level="2" style={{ opacity: 0.7 }}>
                          {q.description}
                        </Caption>
                      )}
                    </div>
                    <div style={{ whiteSpace: 'nowrap', opacity: 0.8 }}>
                      {q.completed ? 'Выполнено' : `+${q.xp} XP`}
                    </div>
                  </div>
                </Div>
              </Card>
            ))}
          </CardGrid>
        )}
      </Group>

      {/* Бейджи */}
      <Group header={<Header>Бейджи</Header>}>
        {data && data.badges?.length ? (
          <CardGrid size="s">
            {data.badges.map((b) => (
              <Card key={b.badges.id} style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{b.badges.title}</div>
                {b.badges.description && (
                  <Caption level="2" style={{ opacity: 0.7 }}>
                    {b.badges.description}
                  </Caption>
                )}
                <Caption level="2" style={{ opacity: 0.6, marginTop: 6 }}>
                  Получено: {formatDate(b.awarded_at)}
                </Caption>
              </Card>
            ))}
          </CardGrid>
        ) : (
          <Placeholder>Пока нет бейджей</Placeholder>
        )}
      </Group>

      {/* История */}
      <Group header={<Header>История</Header>}>
        {!data || !data.visits?.length ? (
          <Placeholder>История пуста</Placeholder>
        ) : (
          <>
            {data.visits.slice(0, visibleCount).map((v, i) => {
              const s = statusOf(v);
              const when = formatDate(v.joined_at);
              return (
                <SimpleCell
                  key={`${v.canteen_id}-${i}-${v.joined_at}`}
                  before={s.icon}
                  subtitle={when}
                >
                  {s.label}
                </SimpleCell>
              );
            })}
            <Footer>
              Показано {Math.min(visibleCount, data.visits.length)} из {data.visits.length}
            </Footer>

            {visibleCount < data.visits.length && (
              <Div>
                <Button
                  size="l"
                  stretched
                  mode="secondary"
                  loading={loadingMore}
                  onClick={async () => {
                    // локальная пагинация по уже загруженным данным:
                    // если хочешь реальную подгрузку >50 с бэка — скажи, добавлю API
                    setLoadingMore(true);
                    await new Promise((r) => setTimeout(r, 200)); // маленькая задержка для UX
                    setVisibleCount((n) => n + PAGE_SIZE);
                    setLoadingMore(false);
                  }}
                >
                  Показать ещё
                </Button>
              </Div>
            )}
          </>
        )}
      </Group>
    </>
  );
}