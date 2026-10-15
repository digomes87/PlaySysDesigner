import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { REQUEST_KINDS, type RequestKind } from '../engine/types';
import { useRunStore } from '../game/runStore';
import { useReducedMotion } from './useReducedMotion';

const MAX_PARTICLES_PER_KIND = 4;
/** Must match the `flow-travel` duration in board.css. */
const TRAVEL_SEC = 1.3;

/** Each type has its own color and shape: identity does not rely on color alone. */
const SHAPES: Readonly<Record<RequestKind, string>> = {
  read: 'M-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0',
  write: 'M-3 -3h6v6h-6z',
  bot: 'M0 -4L4 3.2H-4z',
};

/** Logarithmic scale: 1 particle for light traffic, 4 for thousands of rps. */
function particleCount(perTick: number): number {
  if (perTick <= 0) return 0;
  return Math.min(MAX_PARTICLES_PER_KIND, 1 + Math.floor(Math.log10(perTick + 1) * 1.6));
}

function strokeWidth(totalPerTick: number): number {
  return 1.5 + Math.min(3, Math.log10(totalPerTick + 1));
}

/** Link between two components. During the simulation, particles show the traffic crossing it. */
export function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd } = props;
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const reducedMotion = useReducedMotion();
  const isRunning = useRunStore((state) => state.status === 'running');
  // Selector returns text: re-renders only when the edge count changes.
  const counts = useRunStore((state) => {
    const flows = state.snapshot?.flows ?? [];
    return REQUEST_KINDS.map((kind) =>
      flows.reduce((sum, flow) => (flow.edgeId === id && flow.kind === kind ? sum + flow.count : sum), 0),
    ).join(',');
  })
    .split(',')
    .map(Number);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const isActive = isRunning && total > 0;

  return (
    <g className={`flow-edge${selected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ strokeWidth: isActive ? strokeWidth(total) : 1.5 }} />
      {isActive &&
        !reducedMotion &&
        REQUEST_KINDS.flatMap((kind, kindIndex) => {
          const particles = particleCount(counts[kindIndex] ?? 0);
          return Array.from({ length: particles }, (_, index) => {
            const offset = (index / particles + kindIndex * 0.11) * TRAVEL_SEC;
            return (
              <path
                key={`${kind}-${index}`}
                d={SHAPES[kind]}
                className={`flow-particle flow-particle--${kind}`}
                style={{ offsetPath: `path("${path}")`, animationDelay: `-${offset.toFixed(2)}s` }}
              />
            );
          });
        })}
    </g>
  );
}
