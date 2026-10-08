import { Link } from 'react-router-dom';
import { useContentStore } from '../content/contentStore';
import type { ContentIndex, Level } from '../content/schema';
import { useI18n } from '../i18n/useI18n';
import { deriveConcepts } from '../progress/mastery';
import { useProgressStore } from '../progress/progressStore';
import { systemClock } from '../progress/types';
import { levelAccess } from '../progress/unlock';
import './home.css';

interface LevelRowProps {
  readonly level: Level;
  readonly position: number;
  readonly levels: readonly Level[];
  readonly index: ContentIndex;
}

function LevelRow({ level, position, levels, index }: LevelRowProps) {
  const { m, text, dateTime } = useI18n();
  const progress = useProgressStore((state) => state.levels);
  const access = levelAccess(levels, level.id, progress, systemClock);
  const completed = progress.some((entry) => entry.levelId === level.id && entry.completedAt !== null);
  const required = access.status === 'locked' ? levels.find((candidate) => candidate.id === access.requires) : undefined;

  return (
    <li className={`level-row level-row--${access.status}${completed ? ' is-completed' : ''}`}>
      <span className="level-row__number mono" aria-hidden="true">
        {String(position + 1).padStart(2, '0')}
      </span>
      <div className="level-row__body">
        <h3>{text(level.title)}</h3>
        {level.scaffolding.showConcepts ? (
          <ul className="chips">
            {level.concepts.map((conceptId) => {
              const concept = index.concepts.find((entry) => entry.id === conceptId);
              return (
                <li key={conceptId} className="chip">
                  {concept ? text(concept.name) : conceptId}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="level-row__note">{m.home.hiddenConcepts}</p>
        )}
        {access.status === 'locked' && required && <p className="level-row__note">{m.home.locked(text(required.title))}</p>}
        {access.status === 'waiting' && <p className="level-row__note">{m.home.waiting(dateTime(access.availableAt))}</p>}
      </div>
      <div className="level-row__action">
        {completed && <span className="level-row__done">✓ {m.home.completed}</span>}
        {access.status === 'open' ? (
          <Link className={`button${completed ? '' : ' button--signal'}`} to={`/level/${level.id}`}>
            {completed ? m.home.replay : m.home.play} →
          </Link>
        ) : (
          <span className="level-row__lock" aria-hidden="true">
            {access.status === 'waiting' ? '◷' : '⌁'}
          </span>
        )}
      </div>
    </li>
  );
}

export function HomeScreen() {
  const { m } = useI18n();
  const index = useContentStore((state) => state.index);
  const levels = useContentStore((state) => state.levels);
  const answers = useProgressStore((state) => state.answers);
  if (!index) return null;

  const dueCount = deriveConcepts(
    index.concepts.map((concept) => concept.id),
    answers,
    systemClock,
  ).filter((concept) => concept.isDue).length;

  return (
    <main className="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow">{m.home.eyebrow}</p>
          <h1 id="hero-title">{m.home.title}</h1>
          <p className="hero__lead">{m.home.lead}</p>
        </div>
        <ol className="loop-rail" aria-label={m.home.loopTitle}>
          {m.home.loop.map((step, position) => (
            <li key={step.name}>
              <span className="loop-rail__number mono">{position + 1}</span>
              <div>
                <p className="loop-rail__name">{step.name}</p>
                <p className="loop-rail__text">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {dueCount > 0 && (
        <p className="due-banner" role="status">
          <span>◷ {m.home.dueBanner(dueCount)}</span>
          <Link to="/progress">{m.home.dueAction} →</Link>
        </p>
      )}

      <section aria-labelledby="levels-title">
        <h2 id="levels-title" className="eyebrow">
          {m.home.levelsTitle}
        </h2>
        <ol className="level-list">
          {levels.map((level, position) => (
            <LevelRow key={level.id} level={level} position={position} levels={levels} index={index} />
          ))}
        </ol>
      </section>
    </main>
  );
}
