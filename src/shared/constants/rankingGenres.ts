/**
 * ニコニコ動画のランキングジャンル一覧 (フォールバック用静的定義)。
 *
 * 2026年時点の現行ジャンル体系 (featuredKey ベース)。
 * 通常は起動時に RANKING_GENRES IPC で動的取得したものを使い、
 * 取得に失敗した場合のみこの静的一覧を使う。
 * `hasTags` はサブカテゴリ(トレンドタグ)選択に対応しているかどうか。
 */
import type { RankingGenreInfo } from '@shared/types';

export const RANKING_GENRES: RankingGenreInfo[] = [
  { id: 'e9uj2uks', name: '総合', hasTags: false },
  { id: '4eet3ca4', name: 'ゲーム', hasTags: true },
  { id: 'zc49b03a', name: 'アニメ', hasTags: true },
  { id: 'dshv5do5', name: 'ボカロ', hasTags: true },
  { id: 'wnm2mhv0', name: '音声合成実況・解説・劇場', hasTags: true },
  { id: '8kjl94d9', name: 'エンタメ', hasTags: true },
  { id: 'wq76qdin', name: '音楽', hasTags: true },
  { id: '1ya6bnqd', name: '歌ってみた', hasTags: true },
  { id: '6yuf530c', name: '踊ってみた', hasTags: true },
  { id: '6r5jr8nd', name: '演奏してみた', hasTags: true },
  { id: 'v6wdx6p5', name: '解説・講座', hasTags: true },
  { id: 'lq8d5918', name: '料理', hasTags: true },
  { id: 'k1libcse', name: '旅行・アウトドア', hasTags: true },
  { id: '24aa8fkw', name: '自然', hasTags: true },
  { id: '3d8zlls9', name: '乗り物', hasTags: true },
  { id: 'n46kcz9u', name: '技術・工作', hasTags: true },
  { id: 'lzicx0y6', name: '社会・政治・時事', hasTags: true },
  { id: 'p1acxuoz', name: 'MMD', hasTags: true },
  { id: '6mkdo4xd', name: 'VTuber', hasTags: true },
  { id: 'oxzi6bje', name: 'ラジオ', hasTags: true },
  { id: '4w3p65pf', name: 'スポーツ', hasTags: true },
  { id: 'ne72lua2', name: '動物', hasTags: true },
  { id: 'ramuboyn', name: 'その他', hasTags: true },
  { id: 'd2um7mc4', name: '例のソレ', hasTags: true }
];

/**
 * ランキング集計期間 (表示名付き)
 */
export const RANKING_TERMS: { id: 'hour' | '24h' | 'week' | 'month' | 'total'; name: string }[] = [
  { id: 'hour', name: '毎時' },
  { id: '24h', name: '24時間' },
  { id: 'week', name: '週間' },
  { id: 'month', name: '月間' },
  { id: 'total', name: '全期間' }
];
