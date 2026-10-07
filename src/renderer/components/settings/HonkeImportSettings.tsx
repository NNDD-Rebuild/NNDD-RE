import { useEffect, useState } from "react";
import { Section } from "./common";
import { useAppStore } from "../../store/useAppStore";
import {
  HonkeImportCategory,
  IpcChannel,
  type HonkeImportCategoryValue,
  type HonkeImportPolicy,
  type HonkeImportPreview,
  type HonkeImportProgress,
  type HonkeImportReport,
  type HonkeImportSource,
} from "@shared/types";

const CATEGORY_LABELS: Record<
  HonkeImportCategoryValue,
  { label: string; hint: string }
> = {
  [HonkeImportCategory.CONFIG]: {
    label: "設定",
    hint: "音量・コメント表示・画質などRE に対応する項目のみ",
  },
  [HonkeImportCategory.NG]: {
    label: "NGリスト",
    hint: "NGワード/ID/コマンド/NGタグ (許可IDは非対応)",
  },
  [HonkeImportCategory.MYLIST]: {
    label: "マイリスト",
    hint: "フォルダ階層は平坦化して取り込み",
  },
  [HonkeImportCategory.SEARCH]: {
    label: "保存検索",
    hint: "コメント日時順は投稿日時順に変換",
  },
  [HonkeImportCategory.HISTORY]: { label: "再生履歴", hint: "" },
  [HonkeImportCategory.PLAYLIST]: {
    label: "プレイリスト",
    hint: "m3u から動画IDを抽出して取り込み",
  },
  [HonkeImportCategory.LIBRARY]: {
    label: "ライブラリ情報",
    hint: "再生回数・最終再生日・タグ (動画ファイルが存在するものだけ)",
  },
  [HonkeImportCategory.DOWNLOAD_QUEUE]: {
    label: "DLキュー",
    hint: "本家のダウンロードリストをDLキューに追加 (実験的)",
  },
};

const POLICY_LABELS: Record<HonkeImportPolicy, string> = {
  merge: "マージ",
  replace: "置換",
  skip: "取り込まない",
};

interface CategoryState {
  policy: HonkeImportPolicy;
}

export function HonkeImportSettings(): JSX.Element {
  const [candidates, setCandidates] = useState<HonkeImportSource[]>([]);
  const [selected, setSelected] = useState<HonkeImportSource | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const [preview, setPreview] = useState<HonkeImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [states, setStates] = useState<
    Partial<Record<HonkeImportCategoryValue, CategoryState>>
  >({});
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");

  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<HonkeImportReport | null>(null);

  useEffect(() => {
    window.nndd
      .invoke<HonkeImportSource[]>(IpcChannel.HONKE_DETECT)
      .then((list) => {
        setCandidates(list ?? []);
        if (list && list.length > 0) setSelected(list[0]);
      })
      .catch(() => {})
      .finally(() => setDetecting(false));
    return window.nndd.on(IpcChannel.HONKE_PROGRESS, (p: unknown) => {
      const pr = p as HonkeImportProgress;
      setProgress(
        `${CATEGORY_LABELS[pr.category]?.label ?? pr.category}: ${pr.message}`,
      );
    });
  }, []);

  const selectSource = (s: HonkeImportSource | null): void => {
    setSelected(s);
    setPreview(null);
    setReport(null);
    setSourceError(null);
  };

  const handlePick = async (): Promise<void> => {
    const dir = await window.nndd.invoke<string | null>(
      IpcChannel.SYS_CHOOSE_DIRECTORY,
    );
    if (!dir) return;
    const src = await window.nndd.invoke<HonkeImportSource | null>(
      IpcChannel.HONKE_RESOLVE,
      dir,
    );
    if (!src) {
      setSourceError(
        "本家NNDDのデータが見つかりません。Local Store フォルダ、または system フォルダを選択してください。",
      );
      return;
    }
    setCandidates((prev) =>
      prev.some((c) => c.label === src.label) ? prev : [...prev, src],
    );
    selectSource(src);
  };

  const handlePreview = async (): Promise<void> => {
    if (!selected) return;
    setPreviewing(true);
    setReport(null);
    try {
      const p = await window.nndd.invoke<HonkeImportPreview>(
        IpcChannel.HONKE_PREVIEW,
        selected,
      );
      setPreview(p);
      const next: Partial<Record<HonkeImportCategoryValue, CategoryState>> = {};
      for (const c of p.categories) {
        const usable = !c.error && c.importable > 0;
        // DLキューは実行すると即ダウンロードが始まるため、既定ではオフ
        next[c.category] = {
          policy:
            usable && c.category !== HonkeImportCategory.DOWNLOAD_QUEUE
              ? "merge"
              : "skip",
        };
      }
      setStates(next);
    } catch (e) {
      setSourceError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const setPolicy = (
    c: HonkeImportCategoryValue,
    policy: HonkeImportPolicy,
  ): void => setStates((prev) => ({ ...prev, [c]: { policy } }));

  const activeCount = Object.values(states).filter(
    (s) => s && s.policy !== "skip",
  ).length;

  const handleApply = async (): Promise<void> => {
    if (!selected || !preview) return;
    const replacing = Object.entries(states)
      .filter(([, s]) => s?.policy === "replace")
      .map(([c]) => CATEGORY_LABELS[c as HonkeImportCategoryValue].label);
    const msg = [
      `${activeCount} 項目をインポートします。`,
      replacing.length > 0
        ? `\n「置換」を選んだ項目 (${replacing.join("、")}) は、既存データが先に削除されます。`
        : "",
      "\n実行前に DB と設定は自動でバックアップされます。続行しますか?",
    ].join("");
    if (!window.confirm(msg)) return;
    setApplying(true);
    setProgress(null);
    try {
      const policies: Partial<
        Record<HonkeImportCategoryValue, HonkeImportPolicy>
      > = {};
      for (const [c, s] of Object.entries(states)) {
        if (s) policies[c as HonkeImportCategoryValue] = s.policy;
      }
      const r = await window.nndd.invoke<HonkeImportReport>(
        IpcChannel.HONKE_APPLY,
        {
          source: selected,
          policies,
          libraryPathFrom: pathFrom.trim() || undefined,
          libraryPathTo: pathFrom.trim() ? pathTo.trim() : undefined,
        },
      );
      setReport(r);
      useAppStore.getState().bumpImportRevision();
      const missing = r.results.find((x) => x.category === HonkeImportCategory.PLAYLIST)?.missingVideoIds ?? [];
      if (
        missing.length > 0 &&
        window.confirm(
          `プレイリストのうち ${missing.length} 件はライブラリに無く、サムネイル等の動画情報がありません。\nダウンロードしますか?`
        )
      ) {
        for (const videoId of missing) {
          window.nndd.invoke(IpcChannel.DOWNLOAD_ENQUEUE, { videoId }).catch(console.error);
        }
      }
    } catch (e) {
      setSourceError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
      setProgress(null);
    }
  };

  const libraryState = states[HonkeImportCategory.LIBRARY];

  return (
    <Section title="本家NNDDからインポート">
      <div className="space-y-6">
        <p className="text-xs text-nndd-subtext">
          本家NNDDの設定・NGリスト・マイリスト・保存検索・履歴・プレイリスト・ライブラリ情報を取り込みます。
          本家のファイルは読み取るだけで、変更しません。ログイン情報は取り込めません。
        </p>

        <section className="space-y-2">
          <h3 className="text-sm font-bold text-nndd-text">1. 取り込み元</h3>
          {detecting ? (
            <p className="text-xs text-nndd-subtext">
              本家NNDDのデータを検索中…
            </p>
          ) : candidates.length === 0 ? (
            <p className="text-xs text-nndd-subtext">
              自動検出できませんでした。フォルダを手動で選択してください。
            </p>
          ) : (
            <div className="border border-nndd-border rounded divide-y divide-nndd-border">
              {candidates.map((c) => (
                <label
                  key={c.label}
                  className="flex items-start gap-2 px-3 py-2 text-xs cursor-pointer"
                >
                  <input
                    type="radio"
                    name="honke-source"
                    checked={selected?.label === c.label}
                    onChange={() => selectSource(c)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 break-all">
                    <span className="text-nndd-text">{c.label}</span>
                    <span className="block text-nndd-subtext">
                      {c.configPath
                        ? `設定: ${c.configPath}`
                        : "設定ファイルなし"}{" "}
                      /{" "}
                      {c.systemDir
                        ? `system: ${c.systemDir}`
                        : "system フォルダなし"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handlePick}
              className="text-xs px-3 py-1.5 bg-nndd-border hover:bg-nndd-accent hover:text-white rounded"
            >
              フォルダを選択…
            </button>
            <button
              onClick={handlePreview}
              disabled={!selected || previewing || applying}
              className="text-xs px-3 py-1.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
            >
              {previewing ? "読み込み中…" : "内容を確認"}
            </button>
          </div>
          <p className="text-xs text-nndd-subtext">
            フォルダは、本家の設定フォルダ (%APPDATA%\&lt;アプリID&gt;\Local
            Store) または system フォルダを選択できます。
          </p>
          {sourceError && <p className="text-xs text-red-500">{sourceError}</p>}
        </section>

        {preview && (
          <section className="space-y-2">
            <h3 className="text-sm font-bold text-nndd-text">
              2. 取り込む内容
            </h3>
            <div className="border border-nndd-border rounded divide-y divide-nndd-border">
              {preview.categories.map((c) => {
                const info = CATEGORY_LABELS[c.category];
                const state = states[c.category];
                const unavailable = !!c.error || c.importable === 0;
                return (
                  <div key={c.category} className="px-3 py-2 text-xs space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="w-28 shrink-0 font-bold text-nndd-text">
                        {info.label}
                      </span>
                      <span className="flex-1 text-nndd-subtext">
                        {c.error
                          ? c.error
                          : `${c.total} 件中 ${c.importable} 件が対象 (うち登録済み ${c.duplicate} 件)`}
                      </span>
                      <select
                        value={state?.policy ?? "skip"}
                        disabled={unavailable || applying}
                        onChange={(e) =>
                          setPolicy(
                            c.category,
                            e.target.value as HonkeImportPolicy,
                          )
                        }
                        className="px-2 py-1 bg-nndd-bg border border-nndd-border rounded disabled:opacity-50"
                      >
                        {(["merge", "replace", "skip"] as HonkeImportPolicy[])
                          .filter(
                            (p) =>
                              p !== "replace" ||
                              c.category !== HonkeImportCategory.DOWNLOAD_QUEUE,
                          )
                          .map((p) => (
                            <option key={p} value={p}>
                              {POLICY_LABELS[p]}
                            </option>
                          ))}
                      </select>
                    </div>
                    {info.hint && (
                      <p className="text-nndd-subtext">{info.hint}</p>
                    )}
                    {c.skipped.length > 0 && (
                      <details className="text-nndd-subtext">
                        <summary className="cursor-pointer">
                          取り込めない項目 {c.skipped.length} 件
                        </summary>
                        <ul className="list-disc pl-5 mt-1 space-y-0.5 max-h-32 overflow-auto">
                          {c.skipped.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>

            {libraryState && libraryState.policy !== "skip" && (
              <div className="border border-nndd-border rounded px-3 py-2 text-xs space-y-1">
                <p className="text-nndd-subtext">
                  ライブラリ情報:
                  本家と動画の保存場所が違う場合は、フォルダの付け替えを指定してください
                  (空欄なら変換しません)。
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pathFrom}
                    onChange={(e) => setPathFrom(e.target.value)}
                    placeholder="本家のライブラリルート (例: H:\NNDD)"
                    className="flex-1 px-2 py-1.5 bg-nndd-bg border border-nndd-border rounded min-w-0"
                  />
                  <span className="text-nndd-subtext">→</span>
                  <input
                    type="text"
                    value={pathTo}
                    onChange={(e) => setPathTo(e.target.value)}
                    placeholder="REでの保存先"
                    className="flex-1 px-2 py-1.5 bg-nndd-bg border border-nndd-border rounded min-w-0"
                  />
                </div>
                <p className="text-nndd-subtext">
                  付け替えは「内容を確認」の結果に反映されません。実行時のみ適用されます。
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleApply}
                disabled={activeCount === 0 || applying}
                className="text-xs px-4 py-1.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
              >
                {applying ? "インポート中…" : "インポート実行"}
              </button>
              {progress && (
                <span className="text-xs text-nndd-subtext">{progress}</span>
              )}
            </div>
          </section>
        )}

        {report && (
          <section className="space-y-2">
            <h3 className="text-sm font-bold text-nndd-text">3. 結果</h3>
            <div className="border border-nndd-border rounded divide-y divide-nndd-border">
              {report.results.map((r) => (
                <div key={r.category} className="px-3 py-2 text-xs space-y-1">
                  <div className="flex gap-3">
                    <span className="w-28 shrink-0 font-bold text-nndd-text">
                      {CATEGORY_LABELS[r.category].label}
                    </span>
                    {r.error ? (
                      <span className="text-red-500">失敗: {r.error}</span>
                    ) : (
                      <span className="text-nndd-subtext">
                        追加 {r.added} / 更新 {r.updated} / スキップ {r.skipped}
                      </span>
                    )}
                  </div>
                  {r.notes.length > 0 && (
                    <details className="text-nndd-subtext">
                      <summary className="cursor-pointer">
                        備考 {r.notes.length} 件
                      </summary>
                      <ul className="list-disc pl-5 mt-1 space-y-0.5 max-h-32 overflow-auto">
                        {r.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
            {report.backupDir && (
              <p className="text-xs text-nndd-subtext break-all">
                取り込み前のバックアップ: {report.backupDir}
              </p>
            )}
          </section>
        )}
      </div>
    </Section>
  );
}
