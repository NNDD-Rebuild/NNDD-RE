/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload';
import type { NnddPreloadApi } from '../preload';

declare global {
  interface Window {
    electron: ElectronAPI;
    nndd: NnddPreloadApi;
  }

  // Electron webview タグの JSX 型宣言
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: string;
          useragent?: string;
          disablewebsecurity?: string;
          webpreferences?: string;
        },
        HTMLElement
      >;
    }
  }
}
