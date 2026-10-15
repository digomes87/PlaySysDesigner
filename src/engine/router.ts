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
 * Picks the next output for the request: among outputs that accept it and are
 * usable, keeps the highest-priority group for the request type and
 * rotates (round-robin) only inside it. `cursor` keeps each group's turn, per request type.
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
  // Each request type has its own turn: groups may have different members.
  const turnKey = `${req.kind}|${top}`;
  const turn = cursor.get(turnKey) ?? 0;
  const link = group[turn % group.length];
  if (!link) return { ok: false, reason: 'no_route' };

  cursor.set(turnKey, turn + 1);
  return { ok: true, link };
}
