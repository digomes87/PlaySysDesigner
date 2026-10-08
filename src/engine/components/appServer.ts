import { PRIORITY, passThrough, samePriority } from './shared';

/** Processa a requisição e a encaminha para a camada de dados ligada a ele. */
export const appServer = passThrough(samePriority(PRIORITY.appServer));
