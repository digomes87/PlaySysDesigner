import type { Board, CostBudget, CostTier } from './types';

const COST_POINTS: Readonly<Record<CostTier, number>> = { low: 1, mid: 2, high: 3 };

export const DEFAULT_COST_BUDGET: CostBudget = { low: 8, mid: 14 };

/** Board cost tier: adds up component points and compares them with the budget. */
export function boardCostTier(board: Board, budget: CostBudget = DEFAULT_COST_BUDGET): CostTier {
  const points = board.nodes
    .filter((node) => node.type !== 'traffic_source')
    .reduce((sum, node) => sum + COST_POINTS[node.spec.costTier], 0);
  if (points <= budget.low) return 'low';
  if (points <= budget.mid) return 'mid';
  return 'high';
}
