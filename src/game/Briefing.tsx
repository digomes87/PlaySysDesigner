import type { ContentIndex, Level } from '../content/schema';
import { useI18n } from '../i18n/useI18n';
import { useGameStore } from './gameStore';

interface BriefingProps {
  readonly level: Level;
  readonly index: ContentIndex;
}

/** Coluna de contexto: missão, requisitos, conceitos e dicas, conforme os andaimes da fase. */
export function Briefing({ level, index }: BriefingProps) {
  const { m, text } = useI18n();
  const hintsShown = useGameStore((state) => state.hintsShown);
  const showNextHint = useGameStore((state) => state.showNextHint);
  const conceptName = (conceptId: string): string => {
    const concept = index.concepts.find((entry) => entry.id === conceptId);
    return concept ? text(concept.name) : conceptId;
  };

  return (
    <div className="briefing">
      <section>
        <p className="eyebrow">{m.play.briefing}</p>
        <h1 className="briefing__title">{text(level.title)}</h1>
        <p className="briefing__text">{text(level.briefing.text)}</p>
      </section>

      <section>
        <h2 className="eyebrow">{m.play.requirements}</h2>
        <ul className="briefing__requirements">
          {level.briefing.requirements.map((requirement) => (
            <li key={requirement.en}>{text(requirement)}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="eyebrow">{m.play.concepts}</h2>
        {level.scaffolding.showConcepts ? (
          <ul className="chips">
            {level.concepts.map((conceptId) => (
              <li key={conceptId} className="chip">
                {conceptName(conceptId)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="briefing__muted">{m.home.hiddenConcepts}</p>
        )}
      </section>

      {level.scaffolding.hints && level.hints.length > 0 && (
        <section>
          <h2 className="eyebrow">{m.play.hints}</h2>
          <ol className="briefing__hints">
            {level.hints.slice(0, hintsShown).map((hint) => (
              <li key={hint.en}>{text(hint)}</li>
            ))}
          </ol>
          {hintsShown < level.hints.length && (
            <button type="button" className="button button--ghost" onClick={showNextHint}>
              {m.play.showHint} ({hintsShown}/{level.hints.length})
            </button>
          )}
        </section>
      )}
    </div>
  );
}
