import { useCallback, useEffect, useState } from 'react';
import type {
  BackupResult,
  DataScope,
  DeviceFlowEvent,
  DeviceFlowStartResult,
  GitHubStatus,
  SyncProfile
} from '@shared/types';
import { GitHubLoginArea } from './githubSync/GitHubLoginArea';
import { DeviceFlowModal } from './githubSync/DeviceFlowModal';
import { ProfileList } from './githubSync/ProfileList';
import { ProfileEditor } from './githubSync/ProfileEditor';

export function BackupSettings(): JSX.Element {
  const [status, setStatus] = useState<GitHubStatus>({ loggedIn: false });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const [deviceFlow, setDeviceFlow] = useState<{
    userCode: string;
    verificationUri: string;
  } | null>(null);
  const [deviceFlowStatusMessage, setDeviceFlowStatusMessage] = useState('');
  const [deviceFlowError, setDeviceFlowError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<SyncProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const s = await window.nndd.invoke<GitHubStatus>(window.nndd.channels.GITHUB_STATUS);
    setStatus(s ?? { loggedIn: false });
  }, []);

  const refreshProfiles = useCallback(async () => {
    const list = await window.nndd.invoke<SyncProfile[]>(window.nndd.channels.BACKUP_LIST_PROFILES);
    setProfiles(list ?? []);
  }, []);

  const refreshActiveProfileId = useCallback(async () => {
    const id = await window.nndd.invoke<string | null>(
      window.nndd.channels.BACKUP_GET_ACTIVE_PROFILE_ID
    );
    setActiveProfileId(id ?? null);
  }, []);

  useEffect(() => {
    Promise.all([refreshStatus(), refreshProfiles(), refreshActiveProfileId()]).finally(() =>
      setLoading(false)
    );
  }, [refreshStatus, refreshProfiles, refreshActiveProfileId]);

  // Device Flow の進捗通知を購読
  useEffect(() => {
    return window.nndd.on(window.nndd.channels.GITHUB_DEVICE_FLOW_EVENT, (...args: unknown[]) => {
      const event = args[0] as DeviceFlowEvent;
      if (event.status === 'success') {
        setDeviceFlow(null);
        setDeviceFlowError(null);
        refreshStatus();
      } else if (event.status === 'expired' || event.status === 'denied' || event.status === 'error') {
        setDeviceFlowError(event.message ?? '認証に失敗しました');
      } else {
        setDeviceFlowStatusMessage(event.message ?? '');
      }
    });
  }, [refreshStatus]);

  const handleLogin = useCallback(async () => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const result = await window.nndd.invoke<DeviceFlowStartResult | { error: string }>(
        window.nndd.channels.GITHUB_START_DEVICE_FLOW
      );
      if (!result || 'error' in result) {
        setLoginError(result?.error ?? 'デバイスコードの取得に失敗しました');
        return;
      }
      setDeviceFlowError(null);
      setDeviceFlowStatusMessage('認証を待っています…');
      setDeviceFlow({ userCode: result.userCode, verificationUri: result.verificationUri });
    } finally {
      setLoginLoading(false);
    }
  }, []);

  const handleCancelDeviceFlow = useCallback(async () => {
    await window.nndd.invoke(window.nndd.channels.GITHUB_CANCEL_DEVICE_FLOW);
    setDeviceFlow(null);
    setDeviceFlowError(null);
  }, []);

  const handleLogout = useCallback(async () => {
    await window.nndd.invoke(window.nndd.channels.GITHUB_LOGOUT);
    await refreshStatus();
  }, [refreshStatus]);

  const handleSelectProfile = useCallback(async (id: string) => {
    await window.nndd.invoke(window.nndd.channels.BACKUP_SET_ACTIVE_PROFILE, id);
    setActiveProfileId(id);
  }, []);

  const handleAddProfile = useCallback(
    async (name: string) => {
      const profile = await window.nndd.invoke<SyncProfile>(
        window.nndd.channels.BACKUP_ADD_PROFILE,
        name
      );
      await refreshProfiles();
      if (profile) await handleSelectProfile(profile.id);
    },
    [refreshProfiles, handleSelectProfile]
  );

  const handleRemoveProfile = useCallback(
    async (id: string) => {
      if (!window.confirm('このプロファイルを削除しますか? (Gist自体は削除されません)')) return;
      await window.nndd.invoke(window.nndd.channels.BACKUP_REMOVE_PROFILE, id);
      if (activeProfileId === id) setActiveProfileId(null);
      await refreshProfiles();
    },
    [activeProfileId, refreshProfiles]
  );

  const handleChangeScope = useCallback(
    async (profileId: string, scope: DataScope) => {
      await window.nndd.invoke(window.nndd.channels.BACKUP_UPDATE_PROFILE, profileId, {
        dataScope: scope
      });
      await refreshProfiles();
    },
    [refreshProfiles]
  );

  const handleLinkGist = useCallback(
    async (profileId: string, gistId: string) => {
      await window.nndd.invoke(window.nndd.channels.BACKUP_LINK_EXISTING_GIST, profileId, gistId);
      await refreshProfiles();
    },
    [refreshProfiles]
  );

  const handleToggleAutoUpload = useCallback(
    async (profileId: string, current: boolean) => {
      await window.nndd.invoke(window.nndd.channels.BACKUP_UPDATE_PROFILE, profileId, {
        autoUploadEnabled: !current
      });
      await refreshProfiles();
    },
    [refreshProfiles]
  );

  const handleUpload = useCallback(async (profileId: string) => {
    setUploading(true);
    setResultMessage(null);
    try {
      const result = await window.nndd.invoke<BackupResult>(
        window.nndd.channels.BACKUP_UPLOAD,
        profileId
      );
      setResultMessage(
        result?.ok ? 'アップロードが完了しました' : `アップロードに失敗しました: ${result?.error}`
      );
      await refreshProfiles();
    } finally {
      setUploading(false);
    }
  }, [refreshProfiles]);

  const handleDownload = useCallback(async (profileId: string) => {
    setDownloading(true);
    setResultMessage(null);
    try {
      const result = await window.nndd.invoke<BackupResult>(
        window.nndd.channels.BACKUP_DOWNLOAD,
        profileId
      );
      if (result?.ok) {
        setResultMessage('ダウンロードが完了しました。設定を反映するため画面をリロードします…');
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setResultMessage(`ダウンロードに失敗しました: ${result?.error}`);
        await refreshProfiles();
      }
    } finally {
      setDownloading(false);
    }
  }, [refreshProfiles]);

  if (loading) {
    return <div className="p-6 text-sm text-nndd-subtext">読み込み中…</div>;
  }

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-base font-bold text-nndd-text mb-1">バックアップ</h2>
        <p className="text-xs text-nndd-subtext">
          GitHub Gist を使ってアプリ設定・NGリスト・マイリスト・スケジュール・保存検索・プレイリスト・
          視聴履歴をバックアップ/同期できます。アップロードはプロファイルごとに手動、または
          「起動時・終了時に自動アップロード」を有効にすると自動で行われます(前回から変更がなければ
          スキップされます)。ダウンロード(ローカルへの反映)は誤操作防止のため常に手動です。
        </p>
      </div>

      <GitHubLoginArea
        status={status}
        loading={loginLoading}
        onLogin={handleLogin}
        onLogout={handleLogout}
      />
      {loginError && <p className="text-xs text-red-500">{loginError}</p>}

      {status.loggedIn && (
        <>
          <ProfileList
            profiles={profiles}
            activeProfileId={activeProfileId}
            onSelect={handleSelectProfile}
            onAdd={handleAddProfile}
            onRemove={handleRemoveProfile}
          />

          {activeProfile && (
            <ProfileEditor
              profile={activeProfile}
              onChangeScope={(scope) => handleChangeScope(activeProfile.id, scope)}
              onToggleAutoUpload={() =>
                handleToggleAutoUpload(activeProfile.id, !!activeProfile.autoUploadEnabled)
              }
              onUpload={() => handleUpload(activeProfile.id)}
              onDownload={() => handleDownload(activeProfile.id)}
              onLinkGist={(gistId) => handleLinkGist(activeProfile.id, gistId)}
              uploading={uploading}
              downloading={downloading}
              resultMessage={resultMessage}
            />
          )}
        </>
      )}

      {deviceFlow && (
        <DeviceFlowModal
          userCode={deviceFlow.userCode}
          verificationUri={deviceFlow.verificationUri}
          statusMessage={deviceFlowStatusMessage}
          errorMessage={deviceFlowError}
          onCancel={handleCancelDeviceFlow}
        />
      )}
    </div>
  );
}
