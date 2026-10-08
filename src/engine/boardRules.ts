import type { Board } from './types';

export type BoardIssueCode =
  | 'missing_source'
  | 'unknown_node'
  | 'self_loop'
  | 'duplicate_edge'
  | 'edge_into_source'
  | 'source_multiple_outputs';

export interface BoardIssue {
  readonly code: BoardIssueCode;
  readonly nodeId?: string;
  readonly edgeId?: string;
}

/**
 * Regras de montagem do tabuleiro, independentes da fase. A origem do tráfego só
 * pode ter uma saída: o cliente conhece um endereço, e repartir carga é trabalho
 * do load balancer.
 */
export function validateBoard(board: Board): BoardIssue[] {
  const issues: BoardIssue[] = [];
  const nodes = new Map(board.nodes.map((node) => [node.id, node]));
  const seenLinks = new Set<string>();
  const sourceOutputs = new Map<string, number>();

  if (!board.nodes.some((node) => node.type === 'traffic_source')) issues.push({ code: 'missing_source' });

  for (const edge of board.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) {
      issues.push({ code: 'unknown_node', edgeId: edge.id });
      continue;
    }
    if (edge.from === edge.to) issues.push({ code: 'self_loop', edgeId: edge.id, nodeId: edge.from });
    if (to.type === 'traffic_source') issues.push({ code: 'edge_into_source', edgeId: edge.id, nodeId: to.id });

    const link = `${edge.from}\u0000${edge.to}`;
    if (seenLinks.has(link)) issues.push({ code: 'duplicate_edge', edgeId: edge.id });
    seenLinks.add(link);

    if (from.type === 'traffic_source') sourceOutputs.set(from.id, (sourceOutputs.get(from.id) ?? 0) + 1);
  }

  for (const [nodeId, count] of sourceOutputs) {
    if (count > 1) issues.push({ code: 'source_multiple_outputs', nodeId });
  }
  return issues;
}
