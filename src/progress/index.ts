import { IdbProgressRepository } from './idbRepository';
import type { ProgressRepository } from './types';

/** Para trocar o armazenamento (ex.: sync remoto), mude só esta linha. */
export const progressRepository: ProgressRepository = new IdbProgressRepository();

export * from './mastery';
export * from './progressFile';
export * from './types';
export * from './unlock';
