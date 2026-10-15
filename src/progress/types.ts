import { z } from 'zod';
import { LOCALES } from '../i18n/locales';

export const LOOP_STAGES = ['predict', 'diagnose', 'justify'] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Invalid date.' });

/** One answer to a loop question. The only data mastery is derived from. */
export const answerSchema = z.object({
  conceptId: z.string().min(1),
  levelId: z.string().min(1),
  questionId: z.string().min(1),
  stage: z.enum(LOOP_STAGES),
  selectedOptionId: z.string().min(1),
  correct: z.boolean(),
  /** ISO 8601. */
  at: isoDate,
});

export type Answer = z.infer<typeof answerSchema>;

export const levelProgressSchema = z.object({
  levelId: z.string().min(1),
  /** How many times the simulation was run in the level. */
  runs: z.number().int().min(0),
  /** First time the level was completed (won and justified); null until then. */
  completedAt: isoDate.nullable(),
});

export type LevelProgress = z.infer<typeof levelProgressSchema>;

export const settingsSchema = z.object({
  /** null until the player chooses: the browser language applies. */
  locale: z.enum(LOCALES).nullable(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = { locale: null };

export const PROGRESS_EXPORT_FORMAT = 'playsysdesigner-progress';
export const PROGRESS_EXPORT_VERSION = 1;

export const progressExportSchema = z.object({
  format: z.literal(PROGRESS_EXPORT_FORMAT),
  version: z.literal(PROGRESS_EXPORT_VERSION),
  exportedAt: isoDate,
  answers: z.array(answerSchema),
  levels: z.array(levelProgressSchema),
  settings: settingsSchema,
});

export type ProgressExport = z.infer<typeof progressExportSchema>;

/** Injected clock: tests advance days without waiting. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Persistence boundary. The UI only knows this interface, so swapping
 * IndexedDB for a remote-sync implementation leaves the rest of the app untouched.
 */
export interface ProgressRepository {
  recordAnswer(answer: Answer): Promise<void>;
  listAnswers(): Promise<Answer[]>;
  saveLevelProgress(progress: LevelProgress): Promise<void>;
  listLevelProgress(): Promise<LevelProgress[]>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  exportAll(): Promise<ProgressExport>;
  /** Replaces all local progress with the imported content. */
  importAll(data: ProgressExport): Promise<void>;
  clear(): Promise<void>;
}
