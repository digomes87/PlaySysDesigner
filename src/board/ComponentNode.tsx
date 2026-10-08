import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { BoardNode } from '../engine/types';
import { useRunStore } from '../game/runStore';
import { useI18n } from '../i18n/useI18n';
import { ComponentGlyph, RENDERERS } from '../renderers/registry';

export interface ComponentNodeData extends Record<string, unknown> {
  readonly node: BoardNode;
  readonly title: string;
  readonly specs: readonly string[];
}

export type ComponentFlowNode = Node<ComponentNodeData, 'component'>;

const HOT_UTILIZATION = 0.8;

function loadLevel(utilization: number): 'calm' | 'hot' | 'full' {
  if (utilization >= 1) return 'full';
  return utilization >= HOT_UTILIZATION ? 'hot' : 'calm';
}

/** Uma peça no tabuleiro. Durante a simulação mostra utilização, fila e descartes do nó. */
export function ComponentNode({ id, data, selected }: NodeProps<ComponentFlowNode>) {
  const { m, percent } = useI18n();
  const runtime = useRunStore((state) => state.snapshot?.nodes[id]);
  const dropped = useRunStore((state) =>
    (state.snapshot?.drops ?? []).reduce((sum, drop) => (drop.nodeId === id ? sum + drop.count : sum), 0),
  );
  const { node, title, specs } = data;
  const renderer = RENDERERS[node.type];
  const isSource = node.type === 'traffic_source';
  const showLoad = runtime !== undefined && !isSource;
  const utilization = runtime?.utilization ?? 0;

  const classes = [
    'component-node',
    `component-node--${node.type}`,
    selected ? 'is-selected' : '',
    node.locked ? 'is-locked' : '',
    runtime?.down ? 'is-down' : '',
    dropped > 0 ? 'is-dropping' : '',
  ];

  return (
    <div className={classes.filter(Boolean).join(' ')}>
      {renderer.hasInput && <Handle type="target" position={Position.Left} />}
      <header className="component-node__head">
        <span className="component-node__glyph">
          <ComponentGlyph type={node.type} />
        </span>
        <span className="component-node__title">{title}</span>
      </header>
      {specs.length > 0 && <p className="component-node__specs mono">{specs.join(' · ')}</p>}

      {showLoad && (
        <div className={`component-node__load component-node__load--${loadLevel(utilization)}`}>
          <div
            className="component-node__meter"
            role="meter"
            aria-label={m.play.utilization}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(utilization * 100))}
          >
            <span style={{ transform: `scaleX(${Math.min(1, utilization)})` }} />
          </div>
          <span className="component-node__percent mono">{percent(Math.min(utilization, 9.99), 0)}</span>
        </div>
      )}

      {runtime && (runtime.down || runtime.queued > 0 || dropped > 0) && (
        <ul className="component-node__badges mono">
          {runtime.down && <li className="badge badge--critical">{m.play.down}</li>}
          {runtime.queued > 0 && <li className="badge">{m.play.queued(runtime.queued)}</li>}
          {dropped > 0 && <li className="badge badge--critical">✕ {m.play.dropped(dropped)}</li>}
        </ul>
      )}
      {renderer.hasOutput && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
