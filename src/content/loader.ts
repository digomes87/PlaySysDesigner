import type { z } from 'zod';
import { contentUrl } from './paths';
import { contentIndexSchema, levelSchema, type ContentIndex, type Level, type LevelEntry } from './schema';

export class ContentError extends Error {
  constructor(
    message: string,
    readonly path: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ContentError';
  }
}

/** O conteúdo é dado externo: nada entra no jogo sem passar pelo schema. */
async function loadJson<TSchema extends z.ZodType>(relativePath: string, schema: TSchema): Promise<z.infer<TSchema>> {
  let response: Response;
  try {
    response = await fetch(contentUrl(relativePath));
  } catch (cause) {
    throw new ContentError(`Não foi possível baixar ${relativePath}.`, relativePath, { cause });
  }
  if (!response.ok) throw new ContentError(`${relativePath} respondeu ${response.status}.`, relativePath);

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (cause) {
    throw new ContentError(`${relativePath} não é um JSON válido.`, relativePath, { cause });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? `${first.path.join('.')}: ${first.message}` : 'formato inesperado';
    throw new ContentError(`${relativePath} está fora do schema (${where}).`, relativePath);
  }
  return parsed.data;
}

export function loadContentIndex(): Promise<ContentIndex> {
  return loadJson('index.json', contentIndexSchema);
}

export function loadLevel(entry: LevelEntry): Promise<Level> {
  return loadJson(entry.file, levelSchema);
}
