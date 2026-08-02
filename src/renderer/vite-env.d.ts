/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload';
import type { NnddPreloadApi } from '../preload';

declare global {
  interface Window {
    electron: ElectronAPI;
    nndd: NnddPreloadApi;
    documentPictureInPicture?: DocumentPictureInPicture;
  }

  // Document Picture-in-Picture API (Chromium 116+, TS DOM libに未収録)
  interface DocumentPictureInPicture extends EventTarget {
    readonly window: Window | null;
    requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
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
