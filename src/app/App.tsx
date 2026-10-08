import { useEffect } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useContentStore } from '../content/contentStore';
import { PlayScreen } from '../game/PlayScreen';
import { HomeScreen } from '../home/HomeScreen';
import { LOCALES } from '../i18n/locales';
import { useI18n, useLocaleStore } from '../i18n/useI18n';
import { useProgressStore } from '../progress/progressStore';
import { ReviewScreen } from '../review/ReviewScreen';
import './app.css';

const LOCALE_LABELS = { 'pt-BR': 'PT', en: 'EN' } as const;

function Header() {
  const { m, locale } = useI18n();
  const setLocale = useLocaleStore((state) => state.setLocale);
  return (
    <header className="app-header">
      <NavLink to="/" className="app-header__brand">
        <span className="app-header__mark" aria-hidden="true" />
        {m.app.name}
      </NavLink>
      <nav aria-label={m.app.name} className="app-header__nav">
        <NavLink to="/" end>
          {m.nav.levels}
        </NavLink>
        <NavLink to="/progress">{m.nav.progress}</NavLink>
      </nav>
      <div className="locale-switch" role="radiogroup" aria-label={m.app.language}>
        {LOCALES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === locale}
            lang={option}
            className={option === locale ? 'is-active' : ''}
            onClick={() => setLocale(option)}
          >
            {LOCALE_LABELS[option]}
          </button>
        ))}
      </div>
    </header>
  );
}

function Screens() {
  const { m } = useI18n();
  const contentStatus = useContentStore((state) => state.status);
  const contentError = useContentStore((state) => state.error);
  const progressStatus = useProgressStore((state) => state.status);

  if (contentStatus === 'error') {
    return (
      <main className="notice-page" role="alert">
        <p>{m.common.loadError}</p>
        {contentError && <p className="mono">{contentError}</p>}
        <button type="button" className="button" onClick={() => void useContentStore.getState().load()}>
          {m.common.retry}
        </button>
      </main>
    );
  }
  if (contentStatus !== 'ready' || progressStatus !== 'ready') {
    return (
      <main className="notice-page" aria-busy="true">
        <p className="eyebrow">{m.common.loading}</p>
      </main>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/level/:levelId" element={<PlayScreen />} />
      <Route path="/progress" element={<ReviewScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  useEffect(() => {
    void useLocaleStore.getState().restore();
    void useContentStore.getState().load();
    void useProgressStore.getState().load();
  }, []);

  // HashRouter: as rotas funcionam no GitHub Pages sem precisar de 404.html.
  return (
    <HashRouter>
      <Header />
      <Screens />
    </HashRouter>
  );
}
