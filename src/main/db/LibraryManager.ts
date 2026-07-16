import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { NnddDatabase } from './Database';
import {
  VideoDao,
  MyListDao,
  HistoryDao,
  ScheduleDao,
  SearchDao,
  NgListDao,
  PlaylistDao,
  ResumeDao
} from './dao';
import { NnddPaths } from '@shared/constants';

/**
 * NNDDライブラリ全体の管理。
 * 元: src/org/mineap/nndd/library/sqlite/SQLiteLibraryManager.as
 *
 * - 各DAOを生成して提供
 * - パス管理 (Documents/NNDD-RE/...)
 */
export class LibraryManager {
  readonly db: NnddDatabase;
  readonly videoDao: VideoDao;
  readonly myListDao: MyListDao;
  readonly historyDao: HistoryDao;
  readonly scheduleDao: ScheduleDao;
  readonly searchDao: SearchDao;
  readonly ngListDao: NgListDao;
  readonly playlistDao: PlaylistDao;
  readonly resumeDao: ResumeDao;

  readonly rootDir: string;
  readonly libraryDir: string;
  readonly systemDir: string;
  readonly tempDir: string;
  /** 旧AIR版のファイルベース・プレイリスト実装の名残 (現在未使用、DBベースの playlistDao とは無関係) */
  readonly playlistDir: string;
  readonly logDir: string;
  /** 動画の保存・スキャン対象ディレクトリ。設定で変更可能。 */
  videoDir: string;

  /** libraryRoot 未設定時のデフォルト動画保存先 */
  get defaultVideoDir(): string {
    return path.join(this.rootDir, NnddPaths.LIBRARY_DIR_NAME, NnddPaths.DOWNLOADS_DIR_NAME);
  }

  private constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.libraryDir = path.join(rootDir, NnddPaths.LIBRARY_DIR_NAME);
    this.systemDir = path.join(rootDir, NnddPaths.SYSTEM_DIR_NAME);
    this.tempDir = path.join(rootDir, NnddPaths.TEMP_DIR_NAME);
    this.playlistDir = path.join(rootDir, NnddPaths.PLAYLIST_DIR_NAME);
    this.logDir = path.join(rootDir, NnddPaths.LOG_DIR_NAME);
    this.videoDir = this.defaultVideoDir;

    const dbPath = path.join(this.systemDir, NnddPaths.DB_FILE_NAME);
    this.db = new NnddDatabase(dbPath);

    this.videoDao = new VideoDao(this.db);
    this.myListDao = new MyListDao(this.db);
    this.historyDao = new HistoryDao(this.db);
    this.scheduleDao = new ScheduleDao(this.db);
    this.searchDao = new SearchDao(this.db);
    this.ngListDao = new NgListDao(this.db);
    this.playlistDao = new PlaylistDao(this.db);
    this.resumeDao = new ResumeDao(this.db);
  }

  /**
   * デフォルトのライブラリディレクトリでマネージャーを生成。
   * ~/Documents/NNDD-RE/ がベース。
   */
  static createDefault(): LibraryManager {
    const documentsDir = app
      ? app.getPath('documents')
      : path.join(os.homedir(), 'Documents');
    const root = path.join(documentsDir, NnddPaths.ROOT_DIR_NAME);
    return new LibraryManager(root);
  }

  static createAt(rootDir: string): LibraryManager {
    return new LibraryManager(rootDir);
  }

  close(): void {
    this.db.close();
  }
}
