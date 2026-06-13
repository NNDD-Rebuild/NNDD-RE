import { useEffect, useState } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import { IpcChannel } from '@shared/types';

interface BinaryStatus {
  found: boolean;
  path: string | null;
  version: string | null;
}

interface BinaryStatuses {
  ytDlp: BinaryStatus;
  ffmpeg: BinaryStatus;
  ffplay: BinaryStatus;
  canAutoInstallFfmpeg: boolean;
  hasWinget: boolean;
  platform: string;
  localPaths: { ytDlp: string; ffmpeg: string; ffplay: string };
}

function ffmpegInstallHint(platform: string): string {
  if (platform === 'win32') return 'winget install Gyan.FFmpeg';
  if (platform === 'darwin') return 'brew install ffmpeg';
  return 'sudo apt install ffmpeg';
}

interface BinaryRowProps {
  label: string;
  status: BinaryStatus | null;
  localPath: string;
  pathValue: string;
  onPathChange: (v: string) => void;
  onPathBlur: () => void;
  onBrowse: () => void;
  canAutoInstall: boolean;
  installing: boolean;
  installPct: number;
  installError: string | null;
  onInstall: () => void;
  installLabel: string;
  noInstallNote?: string;
  platform?: string;
}

function BinaryRow({
  label, status, localPath, pathValue, onPathChange, onPathBlur, onBrowse,
  canAutoInstall, installing, installPct, installError, onInstall,
  installLabel, noInstallNote, platform = ''
}: BinaryRowProps): JSX.Element {
  return (
    <section className="bg-nndd-panel border border-nndd-border rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-nndd-text">{label}</span>
        {status ? (
          status.found ? (
            <span className="text-xs text-green-600 dark:text-green-400">
              ✓ {status.version ?? '検出済み'}
            </span>
          ) : (
            <span className="text-xs text-red-500 dark:text-red-400">✗ 未検出</span>
          )
        ) : (
          <span className="text-xs text-nndd-subtext">確認中…</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={pathValue}
          onChange={(e) => onPathChange(e.target.value)}
          onBlur={onPathBlur}
          placeholder={localPath || '空欄 = 自動探索 (PATH + userData/bin)'}
          className="flex-1 bg-nndd-bg border border-nndd-border rounded px-2 py-1 text-xs text-nndd-text placeholder-nndd-subtext focus:outline-none focus:border-nndd-accent"
        />
        <button
          onClick={onBrowse}
          className="px-2 py-1 text-xs bg-nndd-border text-nndd-text rounded hover:bg-nndd-accent hover:text-white"
        >
          参照
        </button>
      </div>

      {canAutoInstall ? (
        installing ? (
          <div className="space-y-1">
            <div className="h-2 bg-nndd-bg rounded overflow-hidden">
              <div
                className="h-full bg-nndd-accent transition-all"
                style={{ width: installPct > 0 ? `${installPct}%` : '15%' }}
              />
            </div>
            <p className="text-xs text-nndd-subtext">
              {installPct > 0 ? `${installPct}% ` : ''}処理中…
            </p>
          </div>
        ) : (
          <button
            onClick={onInstall}
            disabled={installing}
            className="px-3 py-1 text-xs bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-40"
          >
            {installLabel}
          </button>
        )
      ) : noInstallNote ? (
        <div className="text-xs text-nndd-subtext space-y-1">
          <p>{noInstallNote}</p>
          <code className="block bg-nndd-bg px-2 py-1 rounded font-mono">
            {ffmpegInstallHint(platform)}
          </code>
        </div>
      ) : null}

      {installError && (
        <p className="text-xs text-red-500 dark:text-red-400">{installError}</p>
      )}
    </section>
  );
}

export function ExternalToolsSettings(): JSX.Element {
  const [status, setStatus] = useState<BinaryStatuses | null>(null);

  const [installingYtDlp, setInstallingYtDlp] = useState(false);
  const [ytDlpPct, setYtDlpPct] = useState(0);
  const [ytDlpError, setYtDlpError] = useState<string | null>(null);

  const [installingFfmpeg, setInstallingFfmpeg] = useState(false);
  const [ffmpegPct, setFfmpegPct] = useState(0);
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);

  const [ytDlpPath, setYtDlpPath] = useConfig<string>('ytDlpPath', '');
  const [ffmpegPath, setFfmpegPath] = useConfig<string>('ffmpegPath', '');
  const [ffplayPath, setFfplayPath] = useConfig<string>('ffplayPath', '');

  const [ytDlpInput, setYtDlpInput] = useState('');
  const [ffmpegInput, setFfmpegInput] = useState('');
  const [ffplayInput, setFfplayInput] = useState('');

  const refreshStatus = (): void => {
    window.nndd.invoke<BinaryStatuses>(IpcChannel.BINARY_STATUS).then(setStatus).catch(() => {});
  };

  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => { setYtDlpInput(ytDlpPath ?? ''); }, [ytDlpPath]);
  useEffect(() => { setFfmpegInput(ffmpegPath ?? ''); }, [ffmpegPath]);
  useEffect(() => { setFfplayInput(ffplayPath ?? ''); }, [ffplayPath]);

  useEffect(() => {
    const off = window.nndd.on(IpcChannel.BINARY_INSTALL_PROGRESS, (...args: unknown[]) => {
      const data = args[0] as { tool: string; pct: number };
      if (data.tool === 'yt-dlp') setYtDlpPct(Math.round(data.pct * 100));
      if (data.tool === 'ffmpeg') setFfmpegPct(Math.round(data.pct * 100));
    });
    return off;
  }, []);

  const browse = async (
    onSelect: (p: string) => Promise<void>,
    setInput: (v: string) => void
  ): Promise<void> => {
    const filters = status?.platform === 'win32'
      ? [{ name: '実行ファイル', extensions: ['exe'] }]
      : [{ name: 'すべてのファイル', extensions: ['*'] }];
    const selected = await window.nndd.invoke<string | null>(IpcChannel.SYS_CHOOSE_FILE, filters);
    if (selected) {
      setInput(selected);
      await onSelect(selected);
      refreshStatus();
    }
  };

  const saveAndRefresh = async (save: (v: string) => Promise<void>, val: string): Promise<void> => {
    await save(val);
    refreshStatus();
  };

  const handleInstallYtDlp = async (): Promise<void> => {
    setInstallingYtDlp(true); setYtDlpPct(0); setYtDlpError(null);
    try {
      await window.nndd.invoke(IpcChannel.BINARY_INSTALL_YT_DLP);
      refreshStatus();
    } catch (e) {
      setYtDlpError(e instanceof Error ? e.message : String(e));
    } finally { setInstallingYtDlp(false); }
  };

  const handleInstallFfmpeg = async (): Promise<void> => {
    setInstallingFfmpeg(true); setFfmpegPct(0); setFfmpegError(null);
    try {
      await window.nndd.invoke(IpcChannel.BINARY_INSTALL_FFMPEG);
      refreshStatus();
    } catch (e) {
      setFfmpegError(e instanceof Error ? e.message : String(e));
    } finally { setInstallingFfmpeg(false); }
  };

  const canAutoFfmpeg = status?.canAutoInstallFfmpeg ?? false;
  const hasWinget = status?.hasWinget ?? false;
  const platform = status?.platform ?? '';

  const ytDlpInstallLabel = status?.ytDlp.found
    ? 'yt-dlp --update'
    : hasWinget ? 'winget でインストール' : 'ダウンロード';

  const ffmpegInstallLabel = hasWinget
    ? (status?.ffmpeg.found ? 'winget で更新' : 'winget でインストール (ffplay も取得)')
    : (status?.ffmpeg.found ? '再ダウンロード' : 'ダウンロード (ffplay も取得)');

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <h2 className="text-base font-semibold text-nndd-text">外部ツール</h2>

      <BinaryRow
        label="yt-dlp"
        status={status?.ytDlp ?? null}
        localPath={status?.localPaths.ytDlp ?? ''}
        pathValue={ytDlpInput}
        onPathChange={setYtDlpInput}
        onPathBlur={() => saveAndRefresh(setYtDlpPath, ytDlpInput)}
        onBrowse={() => browse(setYtDlpPath, setYtDlpInput)}
        canAutoInstall={true}
        installing={installingYtDlp}
        installPct={ytDlpPct}
        installError={ytDlpError}
        onInstall={handleInstallYtDlp}
        installLabel={ytDlpInstallLabel}
      />

      <BinaryRow
        label="ffmpeg"
        status={status?.ffmpeg ?? null}
        localPath={status?.localPaths.ffmpeg ?? ''}
        pathValue={ffmpegInput}
        onPathChange={setFfmpegInput}
        onPathBlur={() => saveAndRefresh(setFfmpegPath, ffmpegInput)}
        onBrowse={() => browse(setFfmpegPath, setFfmpegInput)}
        canAutoInstall={canAutoFfmpeg}
        installing={installingFfmpeg}
        installPct={ffmpegPct}
        installError={ffmpegError}
        onInstall={handleInstallFfmpeg}
        installLabel={ffmpegInstallLabel}
        noInstallNote="ffmpeg をインストール後、再起動してください:"
        platform={platform}
      />

      <BinaryRow
        label="ffplay"
        status={status?.ffplay ?? null}
        localPath={status?.localPaths.ffplay ?? ''}
        pathValue={ffplayInput}
        onPathChange={setFfplayInput}
        onPathBlur={() => saveAndRefresh(setFfplayPath, ffplayInput)}
        onBrowse={() => browse(setFfplayPath, setFfplayInput)}
        canAutoInstall={false}
        installing={false}
        installPct={0}
        installError={null}
        onInstall={() => {}}
        installLabel=""
        noInstallNote="ffmpeg インストール時に自動で取得されます:"
        platform={platform}
      />
    </div>
  );
}
