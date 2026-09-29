import { useEffect, useRef, useState } from 'react';
import type { NicowariContent, NicowariMedia } from '@shared/types';

interface Props {
  content: NicowariContent;
  /** 本編の video 要素 (音量・ミュートを揃えるため) */
  video: HTMLVideoElement | null;
  /** ニコ割の再生が終わった / 閉じられたとき */
  onEnd: () => void;
}

/** 取り出したバイナリを blob: URL にする (CSP の media-src が data: を許可していないため) */
function useBlobUrl(media: NicowariMedia | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  // 生成と破棄を同じ effect で行う (StrictMode の二重実行でも破棄済み URL を使わない)
  useEffect(() => {
    if (!media) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(new Blob([new Uint8Array(media.data)], { type: media.mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [media]);
  return url;
}

/**
 * ユーザーニコ割のバナー表示。
 * 本家ニコニコ動画では動画の上 (運営コメント等が流れる帯) に 544x56 で表示されていた。
 * 動画に重ねず、プレイヤー上部に帯として置き、その分プレイヤーウィンドウの縦幅を伸ばす。クリックで閉じる。
 * Flash は実行せず、SWF に埋め込まれた静止画と MP3 音声だけを再生する。
 * SWF の長さ (フレーム数 / フレームレート) が経過したら終了する。
 */
export function NicowariBanner({ content, video, onEnd }: Props): JSX.Element | null {
  const imageUrl = useBlobUrl(content.image);
  const audioUrl = useBlobUrl(content.audio);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // 本編と同じ音量・ミュートで鳴らす
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !video) return;
    const sync = (): void => {
      audio.volume = video.volume;
      audio.muted = video.muted;
    };
    sync();
    video.addEventListener('volumechange', sync);
    return () => video.removeEventListener('volumechange', sync);
  }, [video, audioUrl]);

  // 帯の分だけ動画が縮まないよう、表示中はプレイヤーウィンドウの縦幅を帯の高さ分伸ばす。
  // 閉じたら (アンマウント時) 伸ばした分だけ戻す。全画面・最大化中は main 側で何もしない
  useEffect(() => {
    const height = rootRef.current?.offsetHeight ?? 0;
    if (height <= 0) return;
    let cancelled = false;
    let applied = 0;
    window.nndd
      .invoke<number>(window.nndd.channels.PLAYER_WINDOW_ADJUST_HEIGHT, height)
      .then((d) => {
        if (cancelled) {
          if (d) void window.nndd.invoke(window.nndd.channels.PLAYER_WINDOW_ADJUST_HEIGHT, -d);
        } else {
          applied = d;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (applied) {
        void window.nndd
          .invoke(window.nndd.channels.PLAYER_WINDOW_ADJUST_HEIGHT, -applied)
          .catch(() => {});
      }
    };
  }, []);

  // SWF の長さで終了。長さ不明なら音声の終わり、音声も無ければ 5 秒で終了
  useEffect(() => {
    const ms = content.durationSec > 0 ? content.durationSec * 1000 : content.audio ? 0 : 5000;
    if (ms === 0) return;
    const id = window.setTimeout(() => onEndRef.current(), ms);
    return () => window.clearTimeout(id);
  }, [content]);

  return (
    <div
      ref={rootRef}
      className="w-full shrink-0 bg-black flex items-center justify-center cursor-pointer"
      style={{ aspectRatio: `${content.width || 544} / ${content.height || 56}`, maxHeight: '20%' }}
      title="クリックでニコ割を閉じる"
      onClick={() => onEndRef.current()}
    >
      {imageUrl && <img src={imageUrl} alt="" className="w-full h-full object-contain" />}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          autoPlay
          onEnded={() => {
            if (!(content.durationSec > 0)) onEndRef.current();
          }}
        />
      )}
    </div>
  );
}
