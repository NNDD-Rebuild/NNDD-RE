import { ipcMain, webContents } from 'electron';
import { IpcChannel } from '@shared/types';
import type { DeviceFlowEvent, SyncProfile } from '@shared/types';
import { GitHubAuthManager } from '../../github/GitHubAuthManager';
import { GistClient } from '../../github/GistClient';
import type { IpcHandlerContext } from './context';

/** GitHub 連携: OAuth Device Flow (GITHUB_*) と Gist によるバックアップ・同期 (BACKUP_*) */
export function registerBackupHandlers(ctx: IpcHandlerContext): void {
  const { backupManager } = ctx;

  // --- GitHub OAuth Device Flow ---
  GitHubAuthManager.events.on('event', (event: DeviceFlowEvent) => {
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IpcChannel.GITHUB_DEVICE_FLOW_EVENT, event);
    }
  });

  ipcMain.handle(IpcChannel.GITHUB_STATUS, () => {
    return GitHubAuthManager.status();
  });

  ipcMain.handle(IpcChannel.GITHUB_START_DEVICE_FLOW, () => {
    return GitHubAuthManager.startDeviceFlow();
  });

  ipcMain.handle(IpcChannel.GITHUB_CANCEL_DEVICE_FLOW, () => {
    GitHubAuthManager.cancelDeviceFlow();
  });

  ipcMain.handle(IpcChannel.GITHUB_LOGOUT, () => {
    GitHubAuthManager.logout();
  });

  // --- バックアップ・同期 (GitHub Gist) ---
  ipcMain.handle(IpcChannel.BACKUP_LIST_PROFILES, () => {
    return backupManager.listProfiles();
  });

  ipcMain.handle(IpcChannel.BACKUP_GET_ACTIVE_PROFILE_ID, () => {
    return backupManager.getActiveProfileId();
  });

  ipcMain.handle(IpcChannel.BACKUP_ADD_PROFILE, (_e, name: string) => {
    return backupManager.addProfile(name);
  });

  ipcMain.handle(
    IpcChannel.BACKUP_UPDATE_PROFILE,
    (_e, id: string, patch: Partial<SyncProfile>) => {
      return backupManager.updateProfile(id, patch);
    }
  );

  ipcMain.handle(IpcChannel.BACKUP_REMOVE_PROFILE, (_e, id: string) => {
    backupManager.removeProfile(id);
  });

  ipcMain.handle(IpcChannel.BACKUP_SET_ACTIVE_PROFILE, (_e, id: string | null) => {
    backupManager.setActiveProfile(id);
  });

  ipcMain.handle(
    IpcChannel.BACKUP_LINK_EXISTING_GIST,
    (_e, profileId: string, gistId: string) => {
      return backupManager.linkExistingGist(profileId, gistId);
    }
  );

  ipcMain.handle(IpcChannel.BACKUP_LIST_CANDIDATE_GISTS, async () => {
    const token = GitHubAuthManager.getToken();
    if (!token) return [];
    const client = new GistClient(token);
    return client.listCandidates();
  });

  ipcMain.handle(IpcChannel.BACKUP_IMPORT_PROFILES, async () => {
    return backupManager.importProfilesFromGitHub();
  });

  ipcMain.handle(IpcChannel.BACKUP_UPLOAD, async (_e, profileId: string) => {
    return backupManager.upload(profileId);
  });

  ipcMain.handle(IpcChannel.BACKUP_DOWNLOAD, async (_e, profileId: string) => {
    return backupManager.download(profileId);
  });

  ipcMain.handle(IpcChannel.BACKUP_PREVIEW, async (_e, profileId: string) => {
    return backupManager.preview(profileId);
  });

  ipcMain.handle(IpcChannel.BACKUP_LIST_REVISIONS, async (_e, profileId: string) => {
    return backupManager.listRevisions(profileId);
  });

  ipcMain.handle(IpcChannel.BACKUP_RESTORE_REVISION, async (_e, profileId: string, sha: string) => {
    return backupManager.restoreRevision(profileId, sha);
  });
}
