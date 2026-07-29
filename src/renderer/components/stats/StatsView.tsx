import { useEffect, useMemo, useState } from 'react';
import type { NNDDREVideo, HistoryItem } from '@shared/types';

/**
 * 統計タブ。
 * ライブラリ (NNDDREVideo) と視聴履歴 (HistoryItem) から集計値を出すだけの読み取り専用画面。
 * 新規テーブル・新規IPCは追加せず、既存の一覧取得結果をクライアント側で集計する。
 */
export function StatsView(): JSX.Element {
  const [videos, setVideos] = useState<NNDDREVideo[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      window.nndd.invoke<NNDDREVideo[]>(window.nndd.channels.LIBRARY_LIST),
      window.nndd.invoke<HistoryItem[]>(window.nndd.channels.HISTORY_LIST, 1000)
    ])
      .then(([v, h]) => {
        setVideos(v ?? []);
        setHistory(h ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const totalCount = videos.length;
    const favoriteCount = videos.filter((v) => v.isFavorite).length;
    const totalSeconds = history.reduce((sum, h) => sum + (h.watchSeconds || 0), 0);
    const totalPlayCount = videos.reduce((sum, v) => sum + (v.playCount || 0), 0);

    const tagCounts = new Map<string, number>();
    for (const v of videos) {
      for (const t of v.tagStrings) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // 直近12ヶ月のDL数推移 (creationDate基準)
    const monthCounts = new Map<string, number>();
    for (const v of videos) {
      const d = v.creationDate;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
    }
    const now = new Date();
    const monthlyDl = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return { label: `${d.getMonth() + 1}月`, count: monthCounts.get(key) ?? 0 };
    });

    // 直近7日の視聴数推移 (history基準)
    const dayCounts = new Map<string, number>();
    for (const h of history) {
      const d = new Date(h.watchedAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }
    const dailyWatch = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, count: dayCounts.get(key) ?? 0 };
    });

    return { totalCount, favoriteCount, totalSeconds, totalPlayCount, topTags, monthlyDl, dailyWatch };
  }, [videos, history]);

  if (loading) {
    return <div className="p-6 text-sm text-nndd-subtext">読み込み中…</div>;
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl overflow-auto h-full">
      <div>
        <h2 className="text-base font-bold text-nndd-text mb-1">統計</h2>
        <p className="text-xs text-nndd-subtext">
          ライブラリと視聴履歴 (直近1000件) から集計した数値です。
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="ライブラリ動画数" value={stats.totalCount.toLocaleString('ja-JP')} />
        <StatCard label="お気に入り数" value={stats.favoriteCount.toLocaleString('ja-JP')} />
        <StatCard label="総再生時間" value={formatHours(stats.totalSeconds)} />
        <StatCard label="総再生回数" value={stats.totalPlayCount.toLocaleString('ja-JP')} />
      </div>

      <BarChartSection
        title="月別ダウンロード数 (直近12ヶ月)"
        items={stats.monthlyDl}
      />

      <BarChartSection
        title="日別視聴数 (直近7日)"
        items={stats.dailyWatch}
      />

      <div>
        <h3 className="text-sm font-bold mb-2">タグ別動画数 トップ10</h3>
        {stats.topTags.length === 0 ? (
          <div className="text-xs text-nndd-subtext">タグが登録された動画がありません。</div>
        ) : (
          <div className="space-y-1">
            {stats.topTags.map(([tag, count]) => {
              const max = stats.topTags[0][1];
              const pct = max > 0 ? (count / max) * 100 : 0;
              return (
                <div key={tag} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-nndd-subtext" title={tag}>{tag}</span>
                  <div className="flex-1 h-4 bg-nndd-border rounded overflow-hidden">
                    <div
                      className="h-full bg-nndd-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-nndd-panel border border-nndd-border rounded p-3">
      <div className="text-xs text-nndd-subtext mb-1">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function BarChartSection({
  title,
  items
}: {
  title: string;
  items: { label: string; count: number }[];
}): JSX.Element {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div>
      <h3 className="text-sm font-bold mb-2">{title}</h3>
      <div className="flex items-end gap-1.5 h-32 border-b border-nndd-border pb-1">
        {items.map((item) => (
          <div key={item.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${item.label}: ${item.count}`}>
            <span className="text-[10px] text-nndd-subtext">{item.count > 0 ? item.count : ''}</span>
            <div
              className="w-full bg-nndd-accent rounded-t"
              style={{ height: `${(item.count / max) * 100}%`, minHeight: item.count > 0 ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {items.map((item) => (
          <span key={item.label} className="flex-1 text-center text-[10px] text-nndd-subtext truncate">
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  if (hours >= 100) return `${Math.round(hours).toLocaleString('ja-JP')}時間`;
  return `${hours.toFixed(1)}時間`;
}
