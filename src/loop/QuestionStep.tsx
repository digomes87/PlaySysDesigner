import { useEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '../content/schema';
import { useI18n } from '../i18n/useI18n';
import { useProgressStore } from '../progress/progressStore';
import type { LoopStage } from '../progress/types';
import { shuffled } from './shuffle';
import './loop.css';

interface QuestionStepProps {
  readonly question: Question;
  readonly stage: LoopStage;
  readonly levelId: string;
  /** Muda a ordem das opções; use um valor novo a cada vez que a pergunta reaparece. */
  readonly shuffleKey: string;
  readonly eyebrow: string;
  /** Frase de contexto acima da pergunta; some depois da resposta para dar lugar à explicação. */
  readonly lead?: string;
  readonly continueLabel: string;
  onContinue(): void;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Uma pergunta do loop. A explicação só aparece depois da resposta, e a resposta
 * é gravada na hora: é ela que alimenta o domínio do conceito.
 */
export function QuestionStep(props: QuestionStepProps) {
  const { question, stage, levelId, shuffleKey, eyebrow, lead, continueLabel, onContinue } = props;
  const { m, text } = useI18n();
  const recordAnswer = useProgressStore((state) => state.recordAnswer);
  const [selected, setSelected] = useState<string | null>(null);
  const options = useMemo(() => shuffled(question.options, `${question.id}:${shuffleKey}`), [question, shuffleKey]);
  const answered = selected !== null;
  const isCorrect = selected === question.correctOptionId;
  const feedback = useRef<HTMLDivElement>(null);
  // Depois da resposta só ficam a opção escolhida e a certa: sobra espaço para a explicação e o botão.
  const visibleOptions = answered
    ? options.filter((option) => option.id === selected || option.id === question.correctOptionId)
    : options;

  useEffect(() => {
    if (answered) feedback.current?.scrollIntoView({ block: 'nearest' });
  }, [answered]);

  function choose(optionId: string): void {
    if (answered) return;
    setSelected(optionId);
    void recordAnswer({
      conceptId: question.conceptId,
      levelId,
      questionId: question.id,
      stage,
      selectedOptionId: optionId,
      correct: optionId === question.correctOptionId,
    });
  }

  return (
    <section className="question" aria-labelledby={`question-${question.id}`}>
      <p className="eyebrow">{eyebrow}</p>
      {lead && !answered && <p className="question__lead">{lead}</p>}
      <h2 id={`question-${question.id}`} className="question__prompt">
        {text(question.prompt)}
      </h2>
      <ol className="question__options">
        {visibleOptions.map((option) => {
          const index = options.indexOf(option);
          const isRight = option.id === question.correctOptionId;
          const state = !answered ? '' : isRight ? ' is-right' : ' is-wrong';
          return (
            <li key={option.id}>
              <button type="button" className={`question__option${state}`} disabled={answered} onClick={() => choose(option.id)}>
                <span className="question__letter mono">{OPTION_LETTERS[index]}</span>
                <span>{text(option.text)}</span>
                {answered && isRight && <span className="question__mark">✓ {m.question.rightAnswer}</span>}
                {answered && !isRight && option.id === selected && <span className="question__mark">✕</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {answered && (
        <div ref={feedback} className={`question__feedback${isCorrect ? ' is-right' : ' is-wrong'}`} role="status">
          <p className="question__verdict">{isCorrect ? `✓ ${m.question.correct}` : `✕ ${m.question.incorrect}`}</p>
          <p>{text(question.explanation)}</p>
          <button type="button" className="button button--signal" onClick={onContinue} autoFocus>
            {continueLabel}
          </button>
        </div>
      )}
    </section>
  );
}
