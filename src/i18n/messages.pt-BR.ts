import type { ComponentType, DropReason, MetricId, RequestKind, SimEventType } from '../engine/types';
import type { ConceptState } from '../progress/mastery';

/** Textos da interface. O inglês precisa ter exatamente estas chaves, senão não compila. */
export interface Messages {
  readonly app: { readonly name: string; readonly tagline: string; readonly language: string };
  readonly nav: { readonly levels: string; readonly progress: string };
  readonly common: {
    readonly loading: string;
    readonly loadError: string;
    readonly retry: string;
    readonly continue: string;
    readonly back: string;
    readonly close: string;
  };
  readonly home: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lead: string;
    readonly loopTitle: string;
    readonly loop: readonly { readonly name: string; readonly text: string }[];
    readonly levelsTitle: string;
    readonly play: string;
    readonly replay: string;
    readonly completed: string;
    readonly locked: (levelTitle: string) => string;
    readonly waiting: (when: string) => string;
    readonly hiddenConcepts: string;
    readonly dueBanner: (count: number) => string;
    readonly dueAction: string;
  };
  readonly play: {
    readonly briefing: string;
    readonly requirements: string;
    readonly concepts: string;
    readonly palette: string;
    readonly paletteHint: string;
    readonly placed: (count: number, max: number) => string;
    readonly hints: string;
    readonly showHint: string;
    readonly run: string;
    readonly reset: string;
    readonly resetConfirm: string;
    readonly speed: string;
    readonly skip: string;
    readonly pause: string;
    readonly resume: string;
    readonly running: string;
    readonly time: (now: string, total: string) => string;
    readonly legend: string;
    readonly dropped: (count: number) => string;
    readonly queued: (count: number) => string;
    readonly down: string;
    readonly utilization: string;
    readonly deleteHint: string;
    readonly notFound: string;
    readonly lockedLevel: string;
    readonly boardIssues: Readonly<Record<string, string>>;
    readonly stages: Readonly<Record<'predict' | 'build' | 'run' | 'diagnose' | 'justify', string>>;
  };
  readonly metrics: {
    readonly title: string;
    readonly limit: string;
    readonly ok: string;
    readonly violated: string;
    readonly violatedAt: (seconds: string) => string;
    readonly names: Readonly<Record<MetricId, string>>;
    readonly tiers: Readonly<Record<'low' | 'mid' | 'high', string>>;
    readonly atMost: (value: string) => string;
    readonly atLeast: (value: string) => string;
  };
  readonly question: {
    readonly predict: string;
    readonly diagnose: string;
    readonly justify: string;
    readonly correct: string;
    readonly incorrect: string;
    readonly rightAnswer: string;
    readonly toBuild: string;
    readonly backToBuild: string;
    readonly finish: string;
    readonly failedTitle: string;
    readonly failedLead: string;
    readonly passedTitle: string;
    readonly passedLead: string;
  };
  readonly complete: {
    readonly title: string;
    readonly lead: string;
    readonly next: string;
    readonly home: string;
    readonly review: string;
  };
  readonly review: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lead: string;
    readonly states: Readonly<Record<ConceptState, string>>;
    readonly due: string;
    readonly nextReview: (when: string) => string;
    readonly neverAnswered: string;
    readonly accuracy: (correct: number, total: number) => string;
    readonly contexts: (count: number) => string;
    readonly practiceIn: string;
    readonly dataTitle: string;
    readonly dataLead: string;
    readonly export: string;
    readonly import: string;
    readonly reset: string;
    readonly resetConfirm: string;
    readonly imported: string;
    readonly importError: string;
  };
  readonly components: Readonly<Record<ComponentType, string>>;
  readonly kinds: Readonly<Record<RequestKind, string>>;
  readonly drops: Readonly<Record<DropReason, string>>;
  readonly events: Readonly<Record<SimEventType, string>>;
  readonly specs: {
    readonly rps: (value: number) => string;
    readonly lag: (ms: number) => string;
    readonly hitRate: (percent: number) => string;
    readonly limit: (value: number) => string;
    readonly buffer: (value: number) => string;
  };
}

export const ptBR: Messages = {
  app: { name: 'PlaySysDesigner', tagline: 'System design que fica na memória', language: 'Idioma' },
  nav: { levels: 'Fases', progress: 'Progresso' },
  common: {
    loading: 'Carregando…',
    loadError: 'Não foi possível carregar o conteúdo.',
    retry: 'Tentar de novo',
    continue: 'Continuar',
    back: 'Voltar',
    close: 'Fechar',
  },
  home: {
    eyebrow: 'Jogo de system design',
    title: 'Monte a arquitetura. Veja onde ela quebra.',
    lead: 'Cada fase põe tráfego simulado em cima do que você montou. Antes, você prevê o que vai falhar. Depois, explica por que falhou ou por que funcionou. É respondendo que o conceito fica.',
    loopTitle: 'Como cada fase funciona',
    loop: [
      { name: 'Prever', text: 'Olhe o sistema inicial e diga o que quebra primeiro.' },
      { name: 'Montar', text: 'Arraste peças para o tabuleiro e ligue umas às outras.' },
      { name: 'Rodar', text: 'O tráfego passa pela arquitetura e as métricas aparecem.' },
      { name: 'Diagnosticar', text: 'Falhou? O jogo não explica: você aponta a causa.' },
      { name: 'Justificar', text: 'Venceu? Diga por quê. Tentativa e erro não passa.' },
    ],
    levelsTitle: 'Fases',
    play: 'Jogar',
    replay: 'Jogar de novo',
    completed: 'Concluída',
    locked: (levelTitle) => `Conclua "${levelTitle}" para abrir`,
    waiting: (when) => `Abre ${when}. A espera faz parte: é um teste de memória.`,
    hiddenConcepts: 'Conceitos não revelados',
    dueBanner: (count) => (count === 1 ? '1 conceito com revisão vencida' : `${count} conceitos com revisão vencida`),
    dueAction: 'Ver progresso',
  },
  play: {
    briefing: 'Missão',
    requirements: 'Requisitos',
    concepts: 'Conceitos',
    palette: 'Peças',
    paletteHint: 'Arraste para o tabuleiro ou clique para adicionar.',
    placed: (count, max) => `${count}/${max}`,
    hints: 'Dicas',
    showHint: 'Mostrar próxima dica',
    run: 'Rodar simulação',
    reset: 'Recomeçar tabuleiro',
    resetConfirm: 'Voltar ao sistema inicial? As peças que você colocou serão removidas.',
    speed: 'Velocidade',
    skip: 'Pular para o fim',
    pause: 'Pausar',
    resume: 'Continuar',
    running: 'Simulação em andamento',
    time: (now, total) => `${now}s de ${total}s`,
    legend: 'Tráfego',
    dropped: (count) => `${count} descartadas`,
    queued: (count) => `${count} na fila`,
    down: 'Fora do ar',
    utilization: 'Utilização',
    deleteHint: 'Selecione uma peça ou ligação e aperte Delete para remover.',
    notFound: 'Fase não encontrada.',
    lockedLevel: 'Esta fase ainda está trancada.',
    boardIssues: {
      missing_source: 'O tabuleiro precisa de uma origem de tráfego.',
      unknown_node: 'Há uma ligação para uma peça que não existe.',
      self_loop: 'Uma peça não pode se ligar a ela mesma.',
      duplicate_edge: 'Essas duas peças já estão ligadas.',
      edge_into_source: 'Nada pode ser ligado na entrada da origem do tráfego.',
      source_multiple_outputs: 'A origem do tráfego só tem uma saída: o cliente conhece um único endereço.',
    },
    stages: { predict: 'Prever', build: 'Montar', run: 'Rodar', diagnose: 'Diagnosticar', justify: 'Justificar' },
  },
  metrics: {
    title: 'Placar',
    limit: 'Limite',
    ok: 'Dentro do limite',
    violated: 'Violado',
    violatedAt: (seconds) => `Violado aos ${seconds}s`,
    names: {
      p99LatencyMs: 'Latência p99',
      errorRate: 'Taxa de erro',
      availability: 'Disponibilidade',
      costTier: 'Custo',
      staleReads: 'Leituras desatualizadas',
      duplicateOps: 'Operações duplicadas',
      lostWrites: 'Escritas perdidas',
    },
    tiers: { low: 'baixo', mid: 'médio', high: 'alto' },
    atMost: (value) => `até ${value}`,
    atLeast: (value) => `no mínimo ${value}`,
  },
  question: {
    predict: 'Antes de montar',
    diagnose: 'O que aconteceu?',
    justify: 'Por que funcionou?',
    correct: 'Certo',
    incorrect: 'Errado',
    rightAnswer: 'Resposta certa',
    toBuild: 'Ir para o tabuleiro',
    backToBuild: 'Voltar ao tabuleiro',
    finish: 'Concluir fase',
    failedTitle: 'A arquitetura não cumpriu os requisitos',
    failedLead: 'Olhe o placar antes de responder. A explicação só aparece depois.',
    passedTitle: 'Todos os requisitos cumpridos',
    passedLead: 'Falta uma coisa: mostrar que não foi sorte.',
  },
  complete: {
    title: 'Fase concluída',
    lead: 'As perguntas desta fase entraram na sua agenda de revisão.',
    next: 'Próxima fase',
    home: 'Todas as fases',
    review: 'Ver progresso',
  },
  review: {
    eyebrow: 'Repetição espaçada',
    title: 'O que ficou na memória',
    lead: 'Um conceito só conta como dominado quando você acerta em duas fases diferentes, com pelo menos 3 dias entre os acertos. Estrela não mede retenção; tempo mede.',
    states: { new: 'Novo', practicing: 'Praticando', mastered: 'Dominado' },
    due: 'Revisão vencida',
    nextReview: (when) => `Próxima revisão: ${when}`,
    neverAnswered: 'Ainda sem respostas',
    accuracy: (correct, total) => `${correct} de ${total} certas`,
    contexts: (count) => (count === 1 ? 'acertado em 1 fase' : `acertado em ${count} fases`),
    practiceIn: 'Praticar em',
    dataTitle: 'Seus dados',
    dataLead: 'O progresso fica só neste aparelho. Exporte para guardar ou levar para outro navegador.',
    export: 'Exportar JSON',
    import: 'Importar JSON',
    reset: 'Apagar progresso',
    resetConfirm: 'Apagar todo o progresso deste aparelho? Não dá para desfazer.',
    imported: 'Progresso importado.',
    importError: 'Não foi possível importar esse arquivo.',
  },
  components: {
    traffic_source: 'Clientes',
    load_balancer: 'Load balancer',
    app_server: 'Servidor de aplicação',
    cache: 'Cache',
    db_primary: 'Banco primário',
    db_replica: 'Réplica de leitura',
    queue: 'Fila',
    worker: 'Worker',
    rate_limiter: 'Rate limiter',
  },
  kinds: { read: 'Leitura', write: 'Escrita', bot: 'Bot' },
  drops: {
    saturated: 'saturado',
    rate_limited: 'barrado',
    node_down: 'fora do ar',
    no_route: 'sem saída',
    partitioned: 'sem rede',
  },
  events: {
    traffic_ramp: 'Tráfego subindo',
    traffic_spike: 'Pico de tráfego',
    bot_wave: 'Onda de bots',
    node_failure: 'Falha de nó',
    network_partition: 'Partição de rede',
    client_retry: 'Clientes repetindo',
    disk_failure: 'Falha de disco',
    cache_flush: 'Cache esvaziado',
  },
  specs: {
    rps: (value) => `${value} rps`,
    lag: (ms) => `lag ${ms} ms`,
    hitRate: (percent) => `${percent}% de acerto`,
    limit: (value) => `${value} bots/s`,
    buffer: (value) => `buffer ${value}`,
  },
};
