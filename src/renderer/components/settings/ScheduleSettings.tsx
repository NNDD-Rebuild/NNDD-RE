import { useEffect, useState } from 'react';
import type { Schedule, MyList } from '@shared/types';
import { ScheduleTargetType } from '@shared/types';
import { Btn, Card, CheckRow, Hint, Row, Select, SettingsPage, TextInput } from './common';

interface FollowUserOption {
  id: string;
  nickname: string;
  iconUrl: string;
}

/**
 * 設定 > スケジュール (DLリスト・ライブラリ設定の一部)。
 *
 * 元: src/ScheduleWindow.mxml + ScheduleManager.as
 *
 * 曜日 + 時刻指定で対象 (マイリスト/シリーズ/フォロー投稿者) を自動更新+新着DL。
 */
export function ScheduleSettings(): JSX.Element {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [mylists, setMylists] = useState<MyList[]>([]);
  const [followUsers, setFollowUsers] = useState<FollowUserOption[]>([]);
  const [editing, setEditing] = useState<Schedule | null>(null);

  const reload = (): void => {
    window.nndd
      .invoke<Schedule[]>(window.nndd.channels.SCHEDULE_LIST)
      .then((rows) =>
        setSchedules(
          rows.map((r) => ({
            ...r,
            targetType: r.targetType || ScheduleTargetType.MYLIST,
            lastRun: r.lastRun ? new Date(r.lastRun) : null
          }))
        )
      );
    window.nndd
      .invoke<MyList[]>(window.nndd.channels.MYLIST_LIST)
      .then((list) => setMylists(list.filter((m) => !m.isDir)));
    window.nndd
      .invoke<FollowUserOption[]>(window.nndd.channels.FOLLOW_USERS)
      .then(setFollowUsers)
      .catch(() => setFollowUsers([]));
  };

  useEffect(reload, []);

  const startNew = (): void => {
    setEditing({
      id: crypto.randomUUID(),
      name: '',
      targetType: ScheduleTargetType.MYLIST,
      targetMyListUrl: mylists[0]?.myListUrl ?? '',
      targetId: '',
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
    <SettingsPage>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold">自動ダウンロードスケジュール</h2>
        <Btn variant="primary" onClick={startNew}>
          新規スケジュール
        </Btn>
      </div>

      {mylists.length === 0 && (
        <Hint className="mb-3">
          マイリストが登録されていません。先にマイリストタブで登録してください。
        </Hint>
      )}

      {/* 一覧 */}
      <table className="nndd-datagrid mb-4">
        <thead>
          <tr>
            <th className="w-12">有効</th>
            <th>名前</th>
            <th className="w-16">種別</th>
            <th>対象</th>
            <th className="w-32">曜日</th>
            <th className="w-20">時刻</th>
            <th className="w-32">最終実行</th>
            <th className="w-28">操作</th>
          </tr>
        </thead>
        <tbody>
          {schedules.length === 0 && (
            <tr>
              <td colSpan={8} className="text-nndd-subtext text-center py-3">
                スケジュールは未設定
              </td>
            </tr>
          )}
          {schedules.map((s) => (
            <tr key={s.id}>
              <td>{s.enabled ? '✓' : ''}</td>
              <td>{s.name}</td>
              <td>{targetTypeLabel(s.targetType)}</td>
              <td className="truncate" title={targetLabel(s, mylists, followUsers)}>
                {targetLabel(s, mylists, followUsers)}
              </td>
              <td>{daysToStr(s.daysOfWeek)}</td>
              <td>{s.time}</td>
              <td className="text-xs">
                {s.lastRun
                  ? new Date(s.lastRun).toLocaleString('ja-JP')
                  : '-'}
              </td>
              <td>
                <span className="flex gap-1">
                  <Btn onClick={() => setEditing(s)}>編集</Btn>
                  <Btn variant="danger" onClick={() => remove(s.id)}>
                    削除
                  </Btn>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 編集フォーム */}
      {editing && (
        <Card title="スケジュール編集">
          <Row label="名前">
            <TextInput
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="w-full"
            />
          </Row>
          <Row label="対象種別">
            <Select
              value={editing.targetType}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  targetType: e.target.value as Schedule['targetType'],
                  // targetId はシリーズIDと投稿者IDで共用のため、種別を変えたら前の値を残さない
                  targetId: ''
                })
              }
              className="w-full"
            >
              <option value={ScheduleTargetType.MYLIST}>マイリスト</option>
              <option value={ScheduleTargetType.SERIES}>シリーズ</option>
              <option value={ScheduleTargetType.FOLLOW_USER}>フォロー中の投稿者</option>
            </Select>
          </Row>

          {editing.targetType === ScheduleTargetType.SERIES ? (
            <Row label="シリーズID/URL">
              <TextInput
                value={editing.targetId}
                onChange={(e) => setEditing({ ...editing, targetId: e.target.value })}
                placeholder="例: 12345 または https://www.nicovideo.jp/series/12345"
                className="w-full"
              />
            </Row>
          ) : editing.targetType === ScheduleTargetType.FOLLOW_USER ? (
            <Row label="対象投稿者">
              {followUsers.length === 0 ? (
                <TextInput
                  value={editing.targetId}
                  onChange={(e) => setEditing({ ...editing, targetId: e.target.value })}
                  placeholder="ユーザーID"
                  className="w-full"
                />
              ) : (
                <Select
                  value={editing.targetId}
                  onChange={(e) => setEditing({ ...editing, targetId: e.target.value })}
                  className="w-full"
                >
                  <option value="">選択してください</option>
                  {followUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nickname}
                    </option>
                  ))}
                </Select>
              )}
            </Row>
          ) : (
            <Row label="対象マイリスト">
              <Select
                value={editing.targetMyListUrl}
                onChange={(e) => setEditing({ ...editing, targetMyListUrl: e.target.value })}
                className="w-full"
              >
                {mylists.map((ml) => (
                  <option key={ml.myListUrl} value={ml.myListUrl}>
                    {ml.myListName}
                  </option>
                ))}
              </Select>
            </Row>
          )}
          <Row label="曜日">
            <div className="flex gap-1">
              {['日', '月', '火', '水', '木', '金', '土'].map((label, d) => (
                <Btn
                  key={d}
                  variant={editing.daysOfWeek.includes(d) ? 'primary' : 'default'}
                  onClick={() => toggleDay(d)}
                  className="w-8 px-0"
                >
                  {label}
                </Btn>
              ))}
            </div>
          </Row>
          <Row label="時刻 (HH:MM)">
            <input
              type="time"
              value={editing.time}
              onChange={(e) => setEditing({ ...editing, time: e.target.value })}
              className="bg-nndd-bg border border-nndd-border rounded px-2 py-1 text-sm"
            />
          </Row>
          <CheckRow
            checked={editing.enabled}
            onChange={(v) => setEditing({ ...editing, enabled: v })}
            label="有効"
          />
          <div className="flex gap-2">
            <Btn variant="primary" onClick={save}>
              保存
            </Btn>
            <Btn onClick={() => setEditing(null)}>キャンセル</Btn>
          </div>
        </Card>
      )}
    </SettingsPage>
  );
}

function targetTypeLabel(t: Schedule['targetType']): string {
  switch (t) {
    case ScheduleTargetType.SERIES:
      return 'シリーズ';
    case ScheduleTargetType.FOLLOW_USER:
      return '投稿者';
    case ScheduleTargetType.MYLIST:
    default:
      return 'マイリスト';
  }
}

function targetLabel(
  s: Schedule,
  mylists: MyList[],
  followUsers: FollowUserOption[]
): string {
  switch (s.targetType) {
    case ScheduleTargetType.SERIES:
      return s.targetId || '(未設定)';
    case ScheduleTargetType.FOLLOW_USER:
      return (
        followUsers.find((u) => u.id === s.targetId)?.nickname ||
        s.targetId ||
        '(未設定)'
      );
    case ScheduleTargetType.MYLIST:
    default:
      return (
        mylists.find((m) => m.myListUrl === s.targetMyListUrl)?.myListName ??
        s.targetMyListUrl
      );
  }
}

function daysToStr(days: number[]): string {
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  return days
    .sort()
    .map((d) => labels[d])
    .join('');
}
