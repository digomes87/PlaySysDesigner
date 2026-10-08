import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import type { Level } from '../content/schema';
import type { Board, BoardNode } from '../engine/types';
import { useGameStore } from '../game/gameStore';
import { useI18n, type I18n } from '../i18n/useI18n';
import { RENDERERS } from '../renderers/registry';
import { ComponentNode, type ComponentFlowNode } from './ComponentNode';
import { FlowEdge } from './FlowEdge';
import { PALETTE_MIME } from './Palette';
import './board.css';

const NODE_TYPES = { component: ComponentNode };
const EDGE_TYPES = { flow: FlowEdge };
const EDGE_COLOR = '#5b74ad';
const DEFAULT_EDGE_OPTIONS = {
  type: 'flow',
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: EDGE_COLOR },
};
const FIT_VIEW_OPTIONS = { padding: 0.18, maxZoom: 1.1 };

function nodeTitle(node: BoardNode, level: Level, i18n: I18n): string {
  const item = level.availableComponents.find((candidate) => candidate.id === node.paletteId);
  return item && level.scaffolding.labels ? i18n.text(item.label) : i18n.m.components[node.type];
}

/** Com rótulos ligados o texto da peça já traz os números; sem eles, mostra a ficha crua. */
function nodeSpecs(node: BoardNode, level: Level, i18n: I18n): string[] {
  const fromPalette = node.paletteId !== undefined;
  if (fromPalette && level.scaffolding.labels) return [];
  return RENDERERS[node.type].specLines(node.spec, i18n.m);
}

function toFlowNodes(board: Board, level: Level, i18n: I18n, previous: readonly ComponentFlowNode[]): ComponentFlowNode[] {
  return board.nodes.map((node) => {
    const existing = previous.find((candidate) => candidate.id === node.id);
    return {
      ...existing,
      id: node.id,
      type: 'component',
      position: node.position,
      deletable: !node.locked,
      data: { node, title: nodeTitle(node, level, i18n), specs: nodeSpecs(node, level, i18n) },
    };
  });
}

interface BoardCanvasProps {
  readonly level: Level;
  /** Fora da etapa de montar o tabuleiro fica só para olhar. */
  readonly editable: boolean;
}

function Canvas({ level, editable }: BoardCanvasProps) {
  const i18n = useI18n();
  const board = useGameStore((state) => state.board);
  const { place, remove, move, link, unlink } = useGameStore.getState();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes] = useState<ComponentFlowNode[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const { locale } = i18n;

  // O tabuleiro do store é a fonte da verdade; aqui só se preserva o que é do React Flow (seleção, medidas).
  useEffect(() => {
    setNodes((previous) => toFlowNodes(board, level, i18n, previous));
    // `i18n` é um objeto novo a cada render; o que importa aqui é o idioma.
  }, [board, level, locale]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fitView(FIT_VIEW_OPTIONS), 60);
    return () => window.clearTimeout(timer);
    // Reenquadra ao trocar de fase e sempre que entra ou sai uma peça, para nada ficar fora da vista.
  }, [level.id, board.nodes.length, fitView]);

  const edges = useMemo<Edge[]>(
    () =>
      board.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        selected: selectedEdges.has(edge.id),
      })),
    [board.edges, selectedEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<ComponentFlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      for (const change of changes) {
        if (change.type === 'remove') remove(change.id);
        if (change.type === 'position' && change.dragging === false && change.position) move(change.id, change.position);
      }
    },
    [move, remove],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') unlink(change.id);
        if (change.type === 'select') {
          setSelectedEdges((current) => {
            const next = new Set(current);
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
            return next;
          });
        }
      }
    },
    [unlink],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      link(connection.source, connection.target);
    },
    [link],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes(PALETTE_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      const paletteId = event.dataTransfer.getData(PALETTE_MIME);
      const item = level.availableComponents.find((candidate) => candidate.id === paletteId);
      if (!item) return;
      event.preventDefault();
      place(item, screenToFlowPosition({ x: event.clientX - 80, y: event.clientY - 30 }));
    },
    [level, place, screenToFlowPosition],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDragOver={editable ? onDragOver : undefined}
      onDrop={editable ? onDrop : undefined}
      nodesConnectable={editable}
      nodesDraggable={editable}
      edgesFocusable={editable}
      deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
      colorMode="dark"
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      minZoom={0.4}
      maxZoom={1.6}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function BoardCanvas(props: BoardCanvasProps) {
  return (
    <div className={`board${props.editable ? '' : ' board--readonly'}`}>
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
