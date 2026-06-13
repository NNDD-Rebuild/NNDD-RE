/**
 * ニコニコ動画のランキングジャンル一覧。
 *
 * 元: src/CategoryList.json (NNDD V4.4.9 同梱)
 *
 * Niconico の `https://www.nicovideo.jp/ranking/genre/{id}` の {id} 部分。
 * 名称は日本語表示用。
 */
export interface RankingGenreInfo {
  /** URL に使うID */
  id: string;
  /** 表示名 */
  name: string;
}

export const RANKING_GENRES: RankingGenreInfo[] = [
  { id: 'all', name: '全ジャンル' },
  { id: 'entertainment', name: 'エンターテイメント' },
  { id: 'radio', name: 'ラジオ' },
  { id: 'music_sound', name: '音楽・サウンド' },
  { id: 'dance', name: 'ダンス' },
  { id: 'animal', name: '動物' },
  { id: 'nature', name: '自然' },
  { id: 'cooking', name: '料理' },
  { id: 'traveling_outdoor', name: '旅行・アウトドア' },
  { id: 'vehicle', name: '乗り物' },
  { id: 'sports', name: 'スポーツ' },
  { id: 'society_politics_news', name: '社会・政治・時事' },
  { id: 'technology_craft', name: '技術・工作' },
  { id: 'commentary_lecture', name: '解説・講座' },
  { id: 'anime', name: 'アニメ' },
  { id: 'game', name: 'ゲーム' },
  { id: 'other', name: 'その他' }
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
