import { useEffect, useState } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import { IpcChannel } from '@shared/types';
import { Btn, Card, CheckRow, CommitInput, Hint, NumberCommitInput, PageTitle, SettingsPage, StatusText } from './common';
import { TailscaleSidecarSection } from './TailscaleSidecarSection';

export interface BinaryStatus {
  found: boolean;
  path: string | null;
  version: string | null;
}

export interface BinaryStatuses {
  ytDlp: BinaryStatus;
  ffmpeg: BinaryStatus;
  canAutoInstallFfmpeg: boolean;
  hasWinget: boolean;
  platform: string;
  localPaths: { ytDlp: string; ffmpeg: string };
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
  onPathCommit: (v: string) => void;
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
  label, status, localPath, pathValue, onPathCommit, onBrowse,
  canAutoInstall, installing, installPct, installError, onInstall,
  installLabel, noInstallNote, platform = ''
}: BinaryRowProps): JSX.Element {
  return (
    <Card
      title={label}
      right={
        status ? (
          status.found ? (
            <StatusText kind="ok">✓ {status.version ?? '検出済み'}</StatusText>
          ) : (
            <StatusText kind="error">✗ 未検出</StatusText>
          )
        ) : (
          <Hint>確認中…</Hint>
        )
      }
    >
      <div className="flex gap-2">
        <CommitInput
          value={pathValue}
          onCommit={onPathCommit}
          placeholder={localPath || '空欄 = 自動探索 (PATH + userData/bin)'}
          className="flex-1"
        />
        <Btn onClick={onBrowse}>参照</Btn>
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
            <Hint>{installPct > 0 ? `${installPct}% ` : ''}処理中…</Hint>
          </div>
        ) : (
          <Btn variant="primary" onClick={onInstall} disabled={installing}>
            {installLabel}
          </Btn>
        )
      ) : noInstallNote ? (
        <div className="space-y-1">
          <Hint>{noInstallNote}</Hint>
          <code className="block text-xs bg-nndd-bg px-2 py-1 rounded font-mono">
            {ffmpegInstallHint(platform)}
          </code>
        </div>
      ) : null}

      {installError && <StatusText kind="error">{installError}</StatusText>}
    </Card>
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

  const [externalEnabled, setExternalEnabled] = useConfig<boolean>('externalPlayer.enabled', false);
  const [externalPath, setExternalPath] = useConfig<string>('externalPlayer.path', '');

  const [ncvEnabled, setNcvEnabled] = useConfig<boolean>('live.ncvEnabled', false);
  const [ncvPath, setNcvPath] = useConfig<string>('live.ncvPath', '');
  const [ncvTimeshift, setNcvTimeshift] = useConfig<boolean>('live.ncvTimeshift', true);
  const [ncvLaunchDelaySec, setNcvLaunchDelaySec] = useConfig<number>('live.ncvLaunchDelaySec', 3);

  const refreshStatus = (): void => {
    window.nndd.invoke<BinaryStatuses>(IpcChannel.BINARY_STATUS).then(setStatus).catch(() => {});
  };

  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => {
    const off = window.nndd.on(IpcChannel.BINARY_INSTALL_PROGRESS, (...args: unknown[]) => {
      const data = args[0] as { tool: string; pct: number };
      if (data.tool === 'yt-dlp') setYtDlpPct(Math.round(data.pct * 100));
      if (data.tool === 'ffmpeg') setFfmpegPct(Math.round(data.pct * 100));
    });
    return off;
  }, []);

  const pickExecutable = async (): Promise<string | null> => {
    const filters = status?.platform === 'win32'
      ? [{ name: '実行ファイル', extensions: ['exe'] }]
      : [{ name: 'すべてのファイル', extensions: ['*'] }];
    return window.nndd.invoke<string | null>(IpcChannel.SYS_CHOOSE_FILE, filters);
  };

  const browseAndSave = async (save: (v: string) => Promise<void>, refresh = false): Promise<void> => {
    const selected = await pickExecutable();
    if (!selected) return;
    await save(selected);
    if (refresh) refreshStatus();
  };

  const saveAndRefresh = async (save: (v: string) => Promise<void>, val: string): Promise<void> => {
    await save(val.trim());
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
    ? (status?.ffmpeg.found ? 'winget で更新' : 'winget でインストール')
    : (status?.ffmpeg.found ? '再ダウンロード' : 'ダウンロード');

  return (
    <SettingsPage>
      <PageTitle title="外部ツール" />

      <BinaryRow
        label="yt-dlp"
        status={status?.ytDlp ?? null}
        localPath={status?.localPaths.ytDlp ?? ''}
        pathValue={ytDlpPath ?? ''}
        onPathCommit={(v) => void saveAndRefresh(setYtDlpPath, v)}
        onBrowse={() => void browseAndSave(setYtDlpPath, true)}
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
        pathValue={ffmpegPath ?? ''}
        onPathCommit={(v) => void saveAndRefresh(setFfmpegPath, v)}
        onBrowse={() => void browseAndSave(setFfmpegPath, true)}
        canAutoInstall={canAutoFfmpeg}
        installing={installingFfmpeg}
        installPct={ffmpegPct}
        installError={ffmpegError}
        onInstall={handleInstallFfmpeg}
        installLabel={ffmpegInstallLabel}
        noInstallNote="ffmpeg をインストール後、再起動してください:"
        platform={platform}
      />

      <TailscaleSidecarSection />

      <Card title="外部プレイヤー">
        <CheckRow
          checked={externalEnabled}
          onChange={(v) => void setExternalEnabled(v)}
          label="動画を外部のプレイヤーで再生する"
        />
        <div className="flex gap-2">
          <CommitInput
            value={externalPath ?? ''}
            onCommit={(v) => void setExternalPath(v.trim())}
            placeholder="VLC や mpv などの実行ファイル"
            className="flex-1"
          />
          <Btn onClick={() => void browseAndSave(setExternalPath)}>参照</Btn>
        </div>
        <Hint>
          ライブラリにある動画はファイルのパスを渡します。ライブラリに無い動画はニコニコの視聴ページURLを渡すので、
          プレイヤーによっては再生できません (mpv は yt-dlp があれば再生できます)。
          連続再生では、選択した動画以降のファイルをまとめて渡します (最大100件)。macOS は .app も指定できます。
        </Hint>
      </Card>

      <Card title="NCV (ニコ生コメントビューア)">
        <CheckRow
          checked={ncvEnabled}
          onChange={(v) => void setNcvEnabled(v)}
          label="生放送を開くとき NCV も起動する"
        />
        <div className="ml-6">
          <CheckRow
            checked={ncvTimeshift}
            disabled={!ncvEnabled}
            onChange={(v) => void setNcvTimeshift(v)}
            label="タイムシフト視聴時も起動する"
          />
        </div>
        <div className="flex gap-2">
          <CommitInput
            value={ncvPath ?? ''}
            onCommit={(v) => void setNcvPath(v.trim())}
            placeholder="NiconamaCommentViewer.exe のパス"
            className="flex-1"
          />
          <Btn onClick={() => void browseAndSave(setNcvPath)}>参照</Btn>
        </div>
        <div className="flex items-center gap-2 text-sm ml-6">
          生放送を開いてから
          <NumberCommitInput
            min={0}
            max={60}
            step={0.5}
            className="w-16"
            value={ncvLaunchDelaySec ?? 3}
            disabled={!ncvEnabled}
            onCommit={(v) => void setNcvLaunchDelaySec(v)}
          />
          秒待ってから NCV を起動 (0 で待たない)
        </div>
        <Hint>
          生放送プレイヤーのコメントリストはタブ表示になります。
          設定 &gt; 生放送の「別の番組を新しいウィンドウで開く」が OFF の場合は /singleinstance を付けて起動し、
          起動済みの NCV を使い回して新しい放送に接続します。
          NCV から開いた番組では NCV を起動しません。
        </Hint>
      </Card>
    </SettingsPage>
  );
}
