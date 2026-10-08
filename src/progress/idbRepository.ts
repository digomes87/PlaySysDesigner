import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_SETTINGS,
  PROGRESS_EXPORT_FORMAT,
  PROGRESS_EXPORT_VERSION,
  answerSchema,
  levelProgressSchema,
  progressExportSchema,
  settingsSchema,
  systemClock,
  type Answer,
  type Clock,
  type LevelProgress,
  type ProgressExport,
  type ProgressRepository,
  type Settings,
} from './types';

const DB_NAME = 'playsysdesigner';
const DB_VERSION = 1;
const SETTINGS_KEY = 'settings';

interface ProgressDb extends DBSchema {
  answers: { key: number; value: Answer };
  levels: { key: string; value: LevelProgress };
  settings: { key: string; value: Settings };
}

/** Progresso só no aparelho, em IndexedDB. Tudo que entra ou sai passa pelo schema. */
export class IdbProgressRepository implements ProgressRepository {
  private db: Promise<IDBPDatabase<ProgressDb>> | null = null;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly dbName: string = DB_NAME,
  ) {}

  async recordAnswer(answer: Answer): Promise<void> {
    const db = await this.open();
    await db.add('answers', answerSchema.parse(answer));
  }

  async listAnswers(): Promise<Answer[]> {
    const db = await this.open();
    return db.getAll('answers');
  }

  async saveLevelProgress(progress: LevelProgress): Promise<void> {
    const db = await this.open();
    await db.put('levels', levelProgressSchema.parse(progress));
  }

  async listLevelProgress(): Promise<LevelProgress[]> {
    const db = await this.open();
    return db.getAll('levels');
  }

  async getSettings(): Promise<Settings> {
    const db = await this.open();
    const stored = settingsSchema.safeParse(await db.get('settings', SETTINGS_KEY));
    return stored.success ? stored.data : DEFAULT_SETTINGS;
  }

  async saveSettings(settings: Settings): Promise<void> {
    const db = await this.open();
    await db.put('settings', settingsSchema.parse(settings), SETTINGS_KEY);
  }

  async exportAll(): Promise<ProgressExport> {
    const [answers, levels, settings] = await Promise.all([
      this.listAnswers(),
      this.listLevelProgress(),
      this.getSettings(),
    ]);
    return {
      format: PROGRESS_EXPORT_FORMAT,
      version: PROGRESS_EXPORT_VERSION,
      exportedAt: this.clock.now().toISOString(),
      answers,
      levels,
      settings,
    };
  }

  async importAll(data: ProgressExport): Promise<void> {
    const valid = progressExportSchema.parse(data);
    const db = await this.open();
    const tx = db.transaction(['answers', 'levels', 'settings'], 'readwrite');
    await Promise.all([tx.objectStore('answers').clear(), tx.objectStore('levels').clear()]);
    await Promise.all([
      ...valid.answers.map((answer) => tx.objectStore('answers').add(answer)),
      ...valid.levels.map((level) => tx.objectStore('levels').put(level)),
      tx.objectStore('settings').put(valid.settings, SETTINGS_KEY),
    ]);
    await tx.done;
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['answers', 'levels', 'settings'], 'readwrite');
    await Promise.all([
      tx.objectStore('answers').clear(),
      tx.objectStore('levels').clear(),
      tx.objectStore('settings').clear(),
    ]);
    await tx.done;
  }

  private open(): Promise<IDBPDatabase<ProgressDb>> {
    this.db ??= openDB<ProgressDb>(this.dbName, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('answers', { autoIncrement: true });
        db.createObjectStore('levels', { keyPath: 'levelId' });
        db.createObjectStore('settings');
      },
    });
    return this.db;
  }
}
