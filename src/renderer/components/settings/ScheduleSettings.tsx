import { useEffect, useState } from 'react';
import type { Schedule, MyList } from '@shared/types';

/**
 * 設定 > スケジュール (DLリスト・ライブラリ設定の一部)。
 *
 * 元: src/ScheduleWindow.mxml + ScheduleManager.as
 *
 * 曜日 + 時刻指定で対象マイリストを自動更新+新着DL。
 */
export function ScheduleSettings(): JSX.Element {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [mylists, setMylists] = useState<MyList[]>([]);
  const [editing, setEditing] = useState<Schedule | null>(null);

  const reload = (): void => {
    window.nndd
      .invoke<Schedule[]>(window.nndd.channels.SCHEDULE_LIST)
      .then((rows) =>
        setSchedules(
          rows.map((r) => ({
            ...r,
            lastRun: r.lastRun ? new Date(r.lastRun) : null
          }))
        )
      );
    window.nndd
      .invoke<MyList[]>(window.nndd.channels.MYLIST_LIST)
      .then(setMylists);
  };

  useEffect(reload, []);

  const startNew = (): void => {
    setEditing({
      id: crypto.randomUUID(),
      name: '',
      targetMyListUrl: mylists[0]?.myListUrl ?? '',
      daysOfWeek: [1, 2, 3, 4, 5], // 月-金
      time: '03:00',
      enabled: true,
      lastRun: null
    });
  };

  const save = async (): Promise<void> => {
    if (!editing) return;
    await window.nndd.invoke(window.nndd.channels.SCHEDULE_ADD, editing);
    setEditing(null);
    reload();
  };

  const remove = async (id: string): Promise<void> => {
    await window.nndd.invoke(window.nndd.channels.SCHEDULE_REMOVE, id);
    reload();
  };

  const toggleDay = (d: number): void => {
    if (!editing) return;
    const has = editing.daysOfWeek.includes(d);
    setEditing({
      ...editing,
      daysOfWeek: has
        ? editing.daysOfWeek.filter((x) => x !== d)
        : [...editing.daysOfWeek, d].sort()
    });
  };

  return (
    <div className="p-4 max-w-3xl">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold">自動ダウンロードスケジュール</h2>
        <button
          onClick={startNew}
          disabled={mylists.length === 0}
          className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
        >
          新規スケジュール
        </button>
      </div>

      {mylists.length === 0 && (
        <div className="text-xs text-nndd-subtext mb-3">
          マイリストが登録されていません。先にマイリストタブで登録してください。
        </div>
      )}

      {/* 一覧 */}
      <table className="nndd-datagrid mb-4">
        <thead>
          <tr>
            <th className="w-12">有効</th>
            <th>名前</th>
            <th>対象マイリスト</th>
            <th className="w-32">曜日</th>
            <th className="w-20">時刻</th>
            <th className="w-32">最終実行</th>
            <th className="w-20">操作</th>
          </tr>
        </thead>
        <tbody>
          {schedules.length === 0 && (
            <tr>
              <td colSpan={7} className="text-nndd-subtext text-center py-3">
                スケジュールは未設定
              </td>
            </tr>
          )}
          {schedules.map((s) => (
            <tr key={s.id}>
              <td>{s.enabled ? '✓' : ''}</td>
              <td>{s.name}</td>
              <td className="truncate" title={s.targetMyListUrl}>
                {mylists.find((m) => m.myListUrl === s.targetMyListUrl)
                  ?.myListName ?? s.targetMyListUrl}
              </td>
              <td>{daysToStr(s.daysOfWeek)}</td>
              <td>{s.time}</td>
              <td className="text-xs">
                {s.lastRun
                  ? new Date(s.lastRun).toLocaleString('ja-JP')
                  : '-'}
              </td>
              <td>
                <button
                  onClick={() => setEditing(s)}
                  className="text-xs px-2 py-0.5 bg-nndd-border rounded mr-1"
                >
                  編集
                </button>
                <button
                  onClick={() => remove(s.id)}
                  className="text-xs px-2 py-0.5 bg-nndd-border hover:bg-red-700 hover:text-white rounded"
                >
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 編集フォーム */}
      {editing && (
        <div className="border border-nndd-border p-3 bg-nndd-panel rounded">
          <div className="text-sm font-bold mb-2">スケジュール編集</div>
          <Row label="名前">
            <input
              value={editing.name}
              onChange={(e) =>
                setEditing({ ...editing, name: e.target.value })
              }
              className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
            />
          </Row>
          <Row label="対象マイリスト">
            <select
              value={editing.targetMyListUrl}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  targetMyListUrl: e.target.value
                })
              }
              className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
            >
              {mylists.map((ml) => (
                <option key={ml.myListUrl} value={ml.myListUrl}>
                  {ml.myListName}
                </option>
              ))}
            </select>
          </Row>
          <Row label="曜日">
            <div className="flex gap-1">
              {['日', '月', '火', '水', '木', '金', '土'].map((label, d) => (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  className={[
                    'text-xs px-2 py-1 rounded w-8',
                    editing.daysOfWeek.includes(d)
                      ? 'bg-nndd-accent text-white'
                      : 'bg-nndd-border'
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="時刻 (HH:MM)">
            <input
              type="time"
              value={editing.time}
              onChange={(e) =>
                setEditing({ ...editing, time: e.target.value })
              }
              className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
            />
          </Row>
          <Row label="有効">
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={(e) =>
                setEditing({ ...editing, enabled: e.target.checked })
              }
            />
          </Row>
          <div className="flex gap-2 mt-3">
            <button
              onClick={save}
              className="text-xs px-3 py-1 bg-nndd-accent text-white rounded hover:opacity-80"
            >
              保存
            </button>
            <button
              onClick={() => setEditing(null)}
              className="text-xs px-3 py-1 bg-nndd-border rounded"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="w-32 text-xs text-nndd-subtext shrink-0">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function daysToStr(days: number[]): string {
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  return days
    .sort()
    .map((d) => labels[d])
    .join('');
}
