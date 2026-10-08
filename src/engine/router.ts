import { BEHAVIORS } from './components/registry';
import type { BoardNode, DropReason, SimRequest } from './types';

export interface OutputLink<TTarget extends { readonly node: BoardNode }> {
  readonly edgeId: string;
  readonly target: TTarget;
}

export type RouteResult<TTarget extends { readonly node: BoardNode }> =
  | { readonly ok: true; readonly link: OutputLink<TTarget> }
  | { readonly ok: false; readonly reason: DropReason };

/**
 * Escolhe a próxima saída para a requisição: entre as saídas que aceitam e estão
 * utilizáveis, fica com o grupo de maior prioridade para o tipo da requisição e
 * reveza (round-robin) só dentro dele. `cursor` guarda a vez de cada grupo, por tipo de requisição.
 */
export function chooseRoute<TTarget extends { readonly node: BoardNode }>(
  req: SimRequest,
  outputs: readonly OutputLink<TTarget>[],
  cursor: Map<string, number>,
  blockedBy: (link: OutputLink<TTarget>) => DropReason | null,
): RouteResult<TTarget> {
  const accepting = outputs.filter((link) => BEHAVIORS[link.target.node.type].accepts(req, link.target.node));
  const firstAccepting = accepting[0];
  if (!firstAccepting) return { ok: false, reason: 'no_route' };

  const usable = accepting.filter((link) => blockedBy(link) === null);
  if (usable.length === 0) return { ok: false, reason: blockedBy(firstAccepting) ?? 'no_route' };

  const priorityOf = (link: OutputLink<TTarget>): number => BEHAVIORS[link.target.node.type].priority[req.kind];
  const top = usable.reduce((highest, link) => Math.max(highest, priorityOf(link)), Number.NEGATIVE_INFINITY);
  const group = usable.filter((link) => priorityOf(link) === top);
  // Cada tipo de requisição tem a própria vez: os grupos podem ter membros diferentes.
  const turnKey = `${req.kind}|${top}`;
  const turn = cursor.get(turnKey) ?? 0;
  const link = group[turn % group.length];
  if (!link) return { ok: false, reason: 'no_route' };

  cursor.set(turnKey, turn + 1);
  return { ok: true, link };
}
