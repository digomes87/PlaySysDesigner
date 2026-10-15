import { IdbProgressRepository } from './idbRepository';
import type { ProgressRepository } from './types';

/** To swap storage (e.g. remote sync), change only this line. */
export const progressRepository: ProgressRepository = new IdbProgressRepository();

export * from './mastery';
export * from './progressFile';
export * from './types';
export * from './unlock';
