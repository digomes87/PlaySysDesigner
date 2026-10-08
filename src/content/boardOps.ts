import type { Board, BoardEdge, BoardNode } from '../engine/types';
import type { Level, PaletteItem } from './schema';

export interface Position {
  readonly x: number;
  readonly y: number;
}

export function edgeIdFor(from: string, to: string): string {
  return `${from}->${to}`;
}

/** Cria um nó do tabuleiro a partir de uma peça da paleta. */
export function nodeFromPalette(item: PaletteItem, nodeId: string, position: Position): BoardNode {
  return { id: nodeId, type: item.type, spec: item.spec, position, paletteId: item.id };
}

export function addNode(board: Board, node: BoardNode): Board {
  return { ...board, nodes: [...board.nodes, node] };
}

/** Remove o nó e as arestas ligadas a ele. Peça travada do sistema inicial não sai. */
export function removeNode(board: Board, nodeId: string): Board {
  const node = board.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.locked) return board;
  return {
    nodes: board.nodes.filter((candidate) => candidate.id !== nodeId),
    edges: board.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
  };
}

export function connect(board: Board, from: string, to: string): Board {
  const edge: BoardEdge = { id: edgeIdFor(from, to), from, to };
  if (board.edges.some((existing) => existing.id === edge.id)) return board;
  return { ...board, edges: [...board.edges, edge] };
}

export function disconnect(board: Board, edgeId: string): Board {
  return { ...board, edges: board.edges.filter((edge) => edge.id !== edgeId) };
}

export function moveNode(board: Board, nodeId: string, position: Position): Board {
  return { ...board, nodes: board.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)) };
}

/** Quantas unidades de cada peça da paleta o jogador já colocou. */
export function countPlaced(board: Board, level: Level): Record<string, number> {
  const paletteIds = new Set(level.availableComponents.map((item) => item.id));
  const counts: Record<string, number> = {};
  for (const node of board.nodes) {
    if (node.paletteId === undefined || !paletteIds.has(node.paletteId)) continue;
    counts[node.paletteId] = (counts[node.paletteId] ?? 0) + 1;
  }
  return counts;
}
