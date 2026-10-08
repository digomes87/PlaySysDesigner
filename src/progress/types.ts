import { z } from 'zod';
import { LOCALES } from '../i18n/locales';

export const LOOP_STAGES = ['predict', 'diagnose', 'justify'] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Data inválida.' });

/** Uma resposta a uma pergunta do loop. É o único dado de onde o domínio é derivado. */
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
  /** Quantas vezes a simulação foi rodada na fase. */
  runs: z.number().int().min(0),
  /** Primeira vez em que a fase foi concluída (venceu e justificou); null enquanto não. */
  completedAt: isoDate.nullable(),
});

export type LevelProgress = z.infer<typeof levelProgressSchema>;

export const settingsSchema = z.object({
  /** null enquanto o jogador não escolheu: vale o idioma do navegador. */
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

/** Relógio injetado: os testes avançam dias sem esperar. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Fronteira de persistência. A UI só conhece esta interface, então trocar o
 * IndexedDB por uma implementação com sync remoto não mexe no resto do app.
 */
export interface ProgressRepository {
  recordAnswer(answer: Answer): Promise<void>;
  listAnswers(): Promise<Answer[]>;
  saveLevelProgress(progress: LevelProgress): Promise<void>;
  listLevelProgress(): Promise<LevelProgress[]>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  exportAll(): Promise<ProgressExport>;
  /** Substitui todo o progresso local pelo conteúdo importado. */
  importAll(data: ProgressExport): Promise<void>;
  clear(): Promise<void>;
}
