import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BoardCanvas } from '../board/BoardCanvas';
import { Palette } from '../board/Palette';
import { useContentStore } from '../content/contentStore';
import type { ContentIndex, Level } from '../content/schema';
import { buildSimConfig } from '../content/simConfig';
import { validateBoard } from '../engine/boardRules';
import { useI18n } from '../i18n/useI18n';
import { QuestionStep } from '../loop/QuestionStep';
import { useProgressStore } from '../progress/progressStore';
import { systemClock } from '../progress/types';
import { levelAccess } from '../progress/unlock';
import { Briefing } from './Briefing';
import { diagnoseQuestionFor, useGameStore, type Stage } from './gameStore';
import { MetricsPanel } from './MetricsPanel';
import { RunBar } from './RunBar';
import { useRunStore } from './runStore';
import './game.css';

const STEPS = ['predict', 'build', 'run', 'diagnose', 'justify'] as const;

function Stepper({ stage }: { readonly stage: Stage }) {
  const { m } = useI18n();
  const current = stage === 'complete' ? 'justify' : stage;
  return (
    <ol className="stepper">
      {STEPS.map((step, index) => (
        <li key={step} className={step === current ? 'is-current' : ''} aria-current={step === current ? 'step' : undefined}>
          <span className="mono">{index + 1}</span>
          {m.play.stages[step]}
        </li>
      ))}
    </ol>
  );
}

function BuildBar({ level }: { readonly level: Level }) {
  const { m } = useI18n();
  const notice = useGameStore((state) => state.notice);
  const { goTo, finishRun, resetBoard } = useGameStore.getState();

  function run(): void {
    const { board } = useGameStore.getState();
    const issue = validateBoard(board)[0];
    if (issue) {
      useGameStore.setState({ notice: issue.code });
      return;
    }
    goTo('run');
    void useProgressStore.getState().recordRun(level.id);
    useRunStore.getState().start(buildSimConfig(level, board), finishRun);
  }

  function reset(): void {
    if (window.confirm(m.play.resetConfirm)) resetBoard();
  }

  return (
    <div className="buildbar">
      {notice && (
        <p className="buildbar__notice" role="alert">
          {m.play.boardIssues[notice]}
        </p>
      )}
      <button type="button" className="button button--ghost" onClick={reset}>
        ↺ {m.play.reset}
      </button>
      <button type="button" className="button button--signal buildbar__run" onClick={run}>
        ▶ {m.play.run}
      </button>
    </div>
  );
}

function CompleteCard({ level, levels }: { readonly level: Level; readonly levels: readonly Level[] }) {
  const { m, text } = useI18n();
  const next = levels[levels.findIndex((candidate) => candidate.id === level.id) + 1];
  const progress = useProgressStore((state) => state.levels);
  const nextIsOpen = next ? levelAccess(levels, next.id, progress, systemClock).status === 'open' : false;
  return (
    <section className="complete">
      <p className="eyebrow">✓ {text(level.title)}</p>
      <h2>{m.complete.title}</h2>
      <p>{m.complete.lead}</p>
      <div className="complete__actions">
        {next && nextIsOpen && (
          <Link className="button button--signal" to={`/level/${next.id}`}>
            {m.complete.next}: {text(next.title)} →
          </Link>
        )}
        <Link className="button" to="/">
          {m.complete.home}
        </Link>
        <Link className="button button--ghost" to="/progress">
          {m.complete.review}
        </Link>
      </div>
    </section>
  );
}

interface DockProps {
  readonly level: Level;
  readonly levels: readonly Level[];
}

/** O que aparece sob o tabuleiro em cada etapa do loop. */
function Dock({ level, levels }: DockProps) {
  const { m } = useI18n();
  const stage = useGameStore((state) => state.stage);
  const result = useGameStore((state) => state.result);
  const attempt = useGameStore((state) => state.attempt);
  const { goTo } = useGameStore.getState();

  if (stage === 'build') return <BuildBar level={level} />;
  if (stage === 'run') return <RunBar level={level} />;
  if (stage === 'complete') {
    return (
      <div className="dock panel">
        <CompleteCard level={level} levels={levels} />
      </div>
    );
  }

  if (stage === 'predict') {
    return (
      <div className="dock panel">
        <QuestionStep
          key={level.predictQuestion.id}
          question={level.predictQuestion}
          stage="predict"
          levelId={level.id}
          shuffleKey={level.id}
          eyebrow={m.question.predict}
          continueLabel={m.question.toBuild}
          onContinue={() => goTo('build')}
        />
      </div>
    );
  }

  if (stage === 'diagnose') {
    const question = diagnoseQuestionFor(level, result);
    if (!question) return <BuildBar level={level} />;
    return (
      <div className="dock panel dock--failed">
        <header className="dock__verdict">
          <h2>✕ {m.question.failedTitle}</h2>
          <p>{m.question.failedLead}</p>
        </header>
        <QuestionStep
          key={`${question.id}-${attempt}`}
          question={question}
          stage="diagnose"
          levelId={level.id}
          shuffleKey={String(attempt)}
          eyebrow={m.question.diagnose}
          continueLabel={m.question.backToBuild}
          onContinue={() => goTo('build')}
        />
      </div>
    );
  }

  return (
    <div className="dock panel dock--passed">
      <header className="dock__verdict">
        <h2>✓ {m.question.passedTitle}</h2>
        <p>{m.question.passedLead}</p>
      </header>
      <QuestionStep
        key={level.justifyQuestion.id}
        question={level.justifyQuestion}
        stage="justify"
        levelId={level.id}
        shuffleKey={`justify-${attempt}`}
        eyebrow={m.question.justify}
        continueLabel={m.question.finish}
        onContinue={() => {
          void useProgressStore.getState().completeLevel(level.id);
          goTo('complete');
        }}
      />
    </div>
  );
}

function Session({ level, levels, index }: { readonly level: Level; readonly levels: readonly Level[]; readonly index: ContentIndex }) {
  const stage = useGameStore((state) => state.stage);
  const activeLevelId = useGameStore((state) => state.level?.id);

  useEffect(() => {
    useRunStore.getState().clear();
    useGameStore.getState().begin(level);
    return () => useRunStore.getState().clear();
  }, [level]);

  // Voltar a montar limpa o retrato da última simulação: o tabuleiro mudou, os números não valem mais.
  useEffect(() => {
    if (stage === 'build') useRunStore.getState().clear();
  }, [stage]);

  if (activeLevelId !== level.id) return null;

  return (
    <div className="play">
      <aside className="play__context">
        <Briefing level={level} index={index} />
        <Palette level={level} disabled={stage !== 'build'} />
      </aside>
      <div className="play__stage">
        <Stepper stage={stage} />
        <div className="play__board">
          <BoardCanvas level={level} editable={stage === 'build'} />
        </div>
        <Dock level={level} levels={levels} />
      </div>
      <aside className="play__score">
        <MetricsPanel level={level} />
      </aside>
    </div>
  );
}

export function PlayScreen() {
  const { m } = useI18n();
  const { levelId } = useParams();
  const index = useContentStore((state) => state.index);
  const levels = useContentStore((state) => state.levels);
  const progress = useProgressStore((state) => state.levels);
  const level = levels.find((candidate) => candidate.id === levelId);

  if (!level || !index) {
    return (
      <main className="notice-page">
        <p>{m.play.notFound}</p>
        <Link className="button" to="/">
          {m.common.back}
        </Link>
      </main>
    );
  }
  if (levelAccess(levels, level.id, progress, systemClock).status !== 'open') {
    return (
      <main className="notice-page">
        <p>{m.play.lockedLevel}</p>
        <Link className="button" to="/">
          {m.common.back}
        </Link>
      </main>
    );
  }
  return (
    <main>
      <Session level={level} levels={levels} index={index} />
    </main>
  );
}
