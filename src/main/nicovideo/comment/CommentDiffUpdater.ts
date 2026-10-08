import fs from 'node:fs';
import path from 'node:path';
import type { NNDDREComment, WatchPageInfo } from '@shared/types';
import { VideoFileSuffix } from '@shared/constants/paths';
import { getConfigStore } from '../../config/ConfigStore';
import { createLogger } from '../../util/Logger';
import { LocalFileHandler } from '../video/LocalFileHandler';
import { CommentClient } from './CommentClient';
import { CommentXmlReader } from './CommentXmlReader';

const log = createLogger('CommentDiffUpdater');

export interface CommentDiffPaths {
  /** 通常コメント XML (`.xml`) */
  commentXml: string;
  /** 投稿者コメント XML (`[Owner].xml`) */
  ownerXml: string;
  /** 今コメ no 配列 (`[NowComment].json`) */
  nowJson: string;
}

export interface CommentDiffOptions {
  /** threadKey 期限切れ時に視聴情報を取り直す関数 */
  refreshWatch?: () => Promise<WatchPageInfo>;
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}

/**
 * DL済み動画のコメントを差分だけ取得して、ローカルのコメントXMLに追記する。
 *
 * - 今コメ ([NowComment].json) を取り直して上書きする
 * - 既存の通常コメントXMLの最新投稿時刻に届くまで過去へ遡る (設定「全コメントDL」には従わない)
 * - 既存XMLのコメントは (thread, no) で重複排除して残す
 */
export class CommentDiffUpdater {
  /** 通常コメントXMLのパスから、同じ動画の関連ファイルのパスを導く */
  static pathsFromCommentXml(commentXml: string): CommentDiffPaths {
    const base = commentXml.slice(0, commentXml.length - path.extname(commentXml).length);
    return {
      commentXml,
      ownerXml: `${base}${VideoFileSuffix.OWNER_COMMENT_XML}`,
      nowJson: `${base}${VideoFileSuffix.NOW_COMMENT_JSON}`
    };
  }

  /** @returns 新たに追記したコメント件数 (通常 + 投稿者) */
  static async update(
    watch: WatchPageInfo,
    paths: CommentDiffPaths,
    opts: CommentDiffOptions = {}
  ): Promise<{ added: number }> {
    const config = getConfigStore();
    const existingMain = CommentXmlReader.readFile(paths.commentXml);
    const stopAtUnixSec = existingMain.reduce((m, c) => Math.max(m, c.date), 0) || undefined;

    // 今コメは全量取得より先に取る (全量取得は時間がかかり、その間に threadKey が切れうる)
    try {
      const now = await CommentClient.fetchComments(watch);
      LocalFileHandler.writeNowCommentJson(paths.nowJson, now.map((c) => c.no));
    } catch (e) {
      log.warn('now comment fetch failed (continuing):', e);
    }

    const fresh = await CommentClient.fetchAllComments(watch, {
      includeEasy: config.get('downloadEasyComments') ?? false,
      comment429RetryWaitSec: config.get('comment429RetryWaitSec') ?? 60,
      stopAtUnixSec,
      refreshWatch: opts.refreshWatch,
      signal: opts.signal,
      onProgress: opts.onProgress
    });

    const main = this.mergeAndWrite(
      paths.commentXml,
      existingMain,
      fresh.filter((c) => c.fork !== 'owner'),
      watch.commentThreads.find((t) => t.fork === 'main')?.id ?? watch.commentThreads[0]?.id ?? '',
      watch.videoId,
      'main'
    );
    const owner = this.mergeAndWrite(
      paths.ownerXml,
      CommentXmlReader.readFile(paths.ownerXml),
      fresh.filter((c) => c.fork === 'owner'),
      watch.commentThreads.find((t) => t.fork === 'owner')?.id ?? '',
      watch.videoId,
      'owner'
    );
    log.verbose(`comment diff: +${main} main, +${owner} owner (${watch.videoId})`);
    return { added: main + owner };
  }

  private static mergeAndWrite(
    filePath: string,
    existing: NNDDREComment[],
    fresh: NNDDREComment[],
    threadId: string,
    videoId: string,
    fork: 'main' | 'owner'
  ): number {
    const known = new Set(existing.map((c) => `${c.thread}:${c.no}`));
    const diff = fresh.filter((c) => !known.has(`${c.thread}:${c.no}`));
    // 追記なしならファイルを触らない (まだ存在しない場合だけ新規作成)
    if (diff.length === 0 && fs.existsSync(filePath)) return 0;
    const merged = [...existing, ...diff].sort((a, b) => a.no - b.no);
    LocalFileHandler.writeCommentXml(filePath, merged, threadId, videoId, fork);
    return diff.length;
  }
}
