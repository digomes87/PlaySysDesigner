import type { DragEvent } from 'react';
import type { Level, PaletteItem } from '../content/schema';
import type { Board } from '../engine/types';
import { useGameStore } from '../game/gameStore';
import { useI18n } from '../i18n/useI18n';
import { ComponentGlyph, RENDERERS } from '../renderers/registry';

export const PALETTE_MIME = 'application/x-playsysdesigner-piece';

const COST_MARKS = { low: '$', mid: '$$', high: '$$$' } as const;
const CLICK_COLUMNS = 4;
const CLICK_SPACING = { x: 210, y: 130 };

/** Onde cai uma peça adicionada por clique: em fileiras logo abaixo do sistema inicial. */
function nextFreePosition(board: Board): { x: number; y: number } {
  const initial = board.nodes.filter((node) => node.paletteId === undefined);
  const placed = board.nodes.length - initial.length;
  const left = Math.min(...initial.map((node) => node.position.x));
  const bottom = Math.max(...initial.map((node) => node.position.y));
  return {
    x: left + 120 + (placed % CLICK_COLUMNS) * CLICK_SPACING.x,
    y: bottom + 150 + Math.floor(placed / CLICK_COLUMNS) * CLICK_SPACING.y,
  };
}

interface PaletteProps {
  readonly level: Level;
  readonly disabled: boolean;
}

export function Palette({ level, disabled }: PaletteProps) {
  const { m, text } = useI18n();
  const board = useGameStore((state) => state.board);
  const place = useGameStore((state) => state.place);

  function onDragStart(event: DragEvent, item: PaletteItem): void {
    event.dataTransfer.setData(PALETTE_MIME, item.id);
    event.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <section className="palette" aria-labelledby="palette-title">
      <h2 id="palette-title" className="eyebrow">
        {m.play.palette}
      </h2>
      <p className="palette__hint">{m.play.paletteHint}</p>
      <ul className="palette__list">
        {level.availableComponents.map((item) => {
          const placed = board.nodes.filter((node) => node.paletteId === item.id).length;
          const exhausted = placed >= item.max;
          const specs = RENDERERS[item.type].specLines(item.spec, m);
          return (
            <li key={item.id}>
              <button
                type="button"
                className="palette__item"
                draggable={!disabled && !exhausted}
                disabled={disabled || exhausted}
                onDragStart={(event) => onDragStart(event, item)}
                onClick={() => place(item, nextFreePosition(board))}
              >
                <span className="palette__glyph">
                  <ComponentGlyph type={item.type} size={22} />
                </span>
                <span className="palette__body">
                  <span className="palette__name">
                    {level.scaffolding.labels ? text(item.label) : m.components[item.type]}
                  </span>
                  {!level.scaffolding.labels && specs.length > 0 && (
                    <span className="palette__specs mono">{specs.join(' · ')}</span>
                  )}
                </span>
                <span className="palette__meta mono">
                  <span title={m.metrics.names.costTier}>{COST_MARKS[item.spec.costTier]}</span>
                  <span>{m.play.placed(placed, item.max)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="palette__hint">{m.play.deleteHint}</p>
    </section>
  );
}
