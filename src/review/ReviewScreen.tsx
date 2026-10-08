import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useContentStore } from '../content/contentStore';
import type { Level } from '../content/schema';
import { useI18n } from '../i18n/useI18n';
import { deriveConcepts, type ConceptProgress } from '../progress/mastery';
import { progressFileName } from '../progress/progressFile';
import { useProgressStore } from '../progress/progressStore';
import { systemClock } from '../progress/types';
import { levelAccess } from '../progress/unlock';
import './review.css';

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface ConceptRowProps {
  readonly concept: ConceptProgress;
  readonly name: string;
  readonly practiceLevels: readonly Level[];
}

function ConceptRow({ concept, name, practiceLevels }: ConceptRowProps) {
  const { m, text, dateTime } = useI18n();
  return (
    <li className={`concept concept--${concept.state}${concept.isDue ? ' is-due' : ''}`}>
      <div className="concept__main">
        <h3>{name}</h3>
        <p className="concept__meta">
          {concept.totalCount === 0
            ? m.review.neverAnswered
            : `${m.review.accuracy(concept.correctCount, concept.totalCount)} · ${m.review.contexts(concept.contexts.length)}`}
        </p>
      </div>
      <p className="concept__state">{m.review.states[concept.state]}</p>
      <p className="concept__review">
        {concept.isDue ? (
          <strong>◷ {m.review.due}</strong>
        ) : (
          concept.nextReviewAt && m.review.nextReview(dateTime(concept.nextReviewAt))
        )}
      </p>
      <p className="concept__practice">
        {practiceLevels.length > 0 && <span>{m.review.practiceIn} </span>}
        {practiceLevels.map((level) => (
          <Link key={level.id} to={`/level/${level.id}`}>
            {text(level.title)}
          </Link>
        ))}
      </p>
    </li>
  );
}

function DataSection() {
  const { m } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ readonly text: string; readonly failed: boolean } | null>(null);

  async function onExport(): Promise<void> {
    const { text, data } = await useProgressStore.getState().exportFile();
    download(progressFileName(data.exportedAt), text);
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await useProgressStore.getState().importFile(await file.text());
      setMessage({ text: m.review.imported, failed: false });
    } catch {
      setMessage({ text: m.review.importError, failed: true });
    }
  }

  async function onReset(): Promise<void> {
    if (!window.confirm(m.review.resetConfirm)) return;
    await useProgressStore.getState().reset();
    setMessage(null);
  }

  return (
    <section className="data panel" aria-labelledby="data-title">
      <div>
        <h2 id="data-title">{m.review.dataTitle}</h2>
        <p>{m.review.dataLead}</p>
      </div>
      <div className="data__actions">
        <button type="button" className="button" onClick={() => void onExport()}>
          ↓ {m.review.export}
        </button>
        <button type="button" className="button" onClick={() => fileInput.current?.click()}>
          ↑ {m.review.import}
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void onImport(event)} />
        <button type="button" className="button button--danger" onClick={() => void onReset()}>
          {m.review.reset}
        </button>
      </div>
      {message && (
        <p className={`data__message${message.failed ? ' is-failed' : ''}`} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

/** Tela de progresso: o que foi retido, o que está vencido para revisão e onde praticar. */
export function ReviewScreen() {
  const { m, text } = useI18n();
  const index = useContentStore((state) => state.index);
  const levels = useContentStore((state) => state.levels);
  const answers = useProgressStore((state) => state.answers);
  const levelProgress = useProgressStore((state) => state.levels);
  if (!index) return null;

  const concepts = deriveConcepts(
    index.concepts.map((concept) => concept.id),
    answers,
    systemClock,
  );
  const openLevels = levels.filter((level) => levelAccess(levels, level.id, levelProgress, systemClock).status === 'open');

  return (
    <main className="review">
      <header className="review__header">
        <p className="eyebrow">{m.review.eyebrow}</p>
        <h1>{m.review.title}</h1>
        <p>{m.review.lead}</p>
      </header>
      <ul className="concept-list">
        {concepts.map((concept) => {
          const entry = index.concepts.find((candidate) => candidate.id === concept.conceptId);
          return (
            <ConceptRow
              key={concept.conceptId}
              concept={concept}
              name={entry ? text(entry.name) : concept.conceptId}
              practiceLevels={openLevels.filter((level) => level.concepts.includes(concept.conceptId))}
            />
          );
        })}
      </ul>
      <DataSection />
    </main>
  );
}
