import { useState } from 'react';
import type { LanVideo } from '@renderer/components/library/libraryUtils';

/**
 * ライブラリタブの LAN ライブラリ (別 PC の NNDD-RE) の一覧取得と再生。
 * 有効/無効 (lanEnabled) は設定読込と一緒に LibraryView 側で持つ。
 */
export function useLanLibrary() {
  const [lanVideos, setLanVideos] = useState<LanVideo[]>([]);
  const [lanReachable, setLanReachable] = useState<boolean | null>(null);
  const [lanLoading, setLanLoading] = useState(false);
  const [playingLanId, setPlayingLanId] = useState<string | null>(null);
  const [lanSearchText, setLanSearchText] = useState('');

  const loadLan = async (): Promise<void> => {
    setLanLoading(true);
    try {
      const status = await window.nndd.invoke<{ reachable: boolean }>(window.nndd.channels.LAN_STATUS);
      setLanReachable(status.reachable);
      if (status.reachable) {
        const list = await window.nndd.invoke<LanVideo[]>(window.nndd.channels.LAN_LIBRARY_LIST);
        setLanVideos(list);
      } else {
        setLanVideos([]);
      }
    } catch {
      setLanReachable(false);
      setLanVideos([]);
    } finally {
      setLanLoading(false);
    }
  };

  const handleLanPlay = async (videoId: string): Promise<void> => {
    setPlayingLanId(videoId);
    try {
      const detail = await window.nndd.invoke<{
        videoId: string;
        videoUrl: string;
        extension: string;
        filename: string;
      } | null>(window.nndd.channels.LAN_VIDEO_STREAM, videoId);
      if (!detail) {
        alert('動画情報の取得に失敗しました');
        return;
      }
      await window.nndd.invoke(window.nndd.channels.VIDEO_OPEN_PLAYER, {
        streamUrl: detail.videoUrl
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPlayingLanId(null);
    }
  };

  return {
    lanVideos,
    lanReachable,
    lanLoading,
    playingLanId,
    lanSearchText,
    setLanSearchText,
    loadLan,
    handleLanPlay
  };
}
