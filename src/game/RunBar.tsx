import type { Level } from '../content/schema';
import { useI18n } from '../i18n/useI18n';
import { SPEEDS, useRunStore } from './runStore';

/** Controles da simulação e linha do tempo com os eventos da fase e as violações. */
export function RunBar({ level }: { readonly level: Level }) {
  const { m, number } = useI18n();
  const status = useRunStore((state) => state.status);
  const speed = useRunStore((state) => state.speed);
  const timeSec = useRunStore((state) => state.snapshot?.timeSec ?? 0);
  const violations = useRunStore((state) => state.violations);
  const { pause, resume, skip, setSpeed } = useRunStore.getState();
  const progress = status === 'finished' ? 1 : Math.min(1, timeSec / level.durationSec);
  const at = (seconds: number): string => `${(seconds / level.durationSec) * 100}%`;

  return (
    <div className="runbar" role="group" aria-label={m.play.running}>
      <div className="runbar__controls">
        {status === 'paused' ? (
          <button type="button" className="button" onClick={resume}>
            ▶ {m.play.resume}
          </button>
        ) : (
          <button type="button" className="button" onClick={pause} disabled={status !== 'running'}>
            ❚❚ {m.play.pause}
          </button>
        )}
        <div className="runbar__speeds" role="radiogroup" aria-label={m.play.speed}>
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === speed}
              className={`runbar__speed mono${option === speed ? ' is-active' : ''}`}
              onClick={() => setSpeed(option)}
            >
              {option}×
            </button>
          ))}
        </div>
        <button type="button" className="button button--ghost" onClick={skip} disabled={status === 'finished'}>
          {m.play.skip} ⏭
        </button>
        <p className="runbar__time mono">{m.play.time(number(timeSec, 1), number(level.durationSec))}</p>
      </div>

      <div className="timeline">
        <div className="timeline__track">
          <span className="timeline__fill" style={{ transform: `scaleX(${progress})` }} />
          {level.events.map((event) => (
            <span
              key={`${event.type}-${event.atSec}`}
              className={`timeline__event${timeSec >= event.atSec ? ' is-past' : ''}`}
              style={{ left: at(event.atSec) }}
            >
              <span className="timeline__label">{m.events[event.type]}</span>
            </span>
          ))}
          {violations.map((violation) => (
            <span
              key={violation.metric}
              className="timeline__violation"
              style={{ left: at(violation.atSec) }}
              title={`${m.metrics.names[violation.metric]} · ${m.metrics.violatedAt(number(violation.atSec, 1))}`}
            >
              ✕
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
