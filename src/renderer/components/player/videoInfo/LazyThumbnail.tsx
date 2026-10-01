import { useState, useEffect, useRef } from 'react';
import { IpcChannel } from '@shared/types';

/** 画面内に入ったときだけ画像を取得するサムネイル (シリーズ / 関連動画タブ用) */
export function LazyThumbnail({ url }: { url: string }): JSX.Element {
  const [src, setSrc] = useState('');
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!url || !ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          window.nndd
            .invoke<string>(IpcChannel.IMAGE_FETCH, url)
            .then(setSrc)
            .catch(() => setSrc(url));
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [url]);

  return (
    <img
      ref={ref}
      src={src}
      alt=""
      className="w-16 h-9 object-cover rounded shrink-0 bg-nndd-border"
    />
  );
}
