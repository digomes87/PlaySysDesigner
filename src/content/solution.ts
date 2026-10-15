import type { Board } from '../engine/types';
import { addNode, connect, disconnect, nodeFromPalette } from './boardOps';
import type { Level } from './schema';

/** The level's reference board: the initial system plus the solution's changes. */
export function applySolution(level: Level): Board {
  const { solution } = level;
  const withNodes = solution.add.reduce<Board>((board, entry) => {
    const item = level.availableComponents.find((candidate) => candidate.id === entry.paletteId);
    return item ? addNode(board, nodeFromPalette(item, entry.nodeId, entry.position)) : board;
  }, level.initialBoard);
  const trimmed = solution.removeEdges.reduce<Board>((board, edgeId) => disconnect(board, edgeId), withNodes);
  return solution.connect.reduce<Board>((board, [from, to]) => connect(board, from, to), trimmed);
}
