import { progressExportSchema, type ProgressExport } from './types';

export class ProgressFileError extends Error {
  constructor(
    readonly reason: 'not_json' | 'wrong_format',
    options?: ErrorOptions,
  ) {
    super(reason === 'not_json' ? 'O arquivo não é um JSON válido.' : 'O arquivo não é um progresso deste jogo.', options);
    this.name = 'ProgressFileError';
  }
}

export function serializeProgress(data: ProgressExport): string {
  return JSON.stringify(data, null, 2);
}

/** Lê um arquivo de progresso exportado. Arquivo vem de fora: valida antes de usar. */
export function parseProgressFile(text: string): ProgressExport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new ProgressFileError('not_json', { cause });
  }
  const parsed = progressExportSchema.safeParse(raw);
  if (!parsed.success) throw new ProgressFileError('wrong_format', { cause: parsed.error });
  return parsed.data;
}

export function progressFileName(exportedAt: string): string {
  return `playsysdesigner-progress-${exportedAt.slice(0, 10)}.json`;
}
