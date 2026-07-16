import type { ElectronAPI } from '@electron-toolkit/preload';
import type { NnddPreloadApi } from './index';

declare global {
  interface Window {
    electron: ElectronAPI;
    nndd: NnddPreloadApi;
  }
}

export {};
