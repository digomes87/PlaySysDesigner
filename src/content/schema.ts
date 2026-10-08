import { z } from 'zod';
import { COMPONENT_TYPES, COST_TIERS, type MetricId } from '../engine/types';
import { LOCALES } from '../i18n/locales';

export const LEVEL_SCHEMA_VERSION = 1;

const EXPLANATION_MAX_CHARS = 280;
const JUSTIFY_OPTION_COUNT = 3;

const METRIC_IDS = [
  'p99LatencyMs',
  'errorRate',
  'availability',
  'costTier',
  'staleReads',
  'duplicateOps',
  'lostWrites',
] as const satisfies readonly MetricId[];

const slug = z.string().regex(/^[a-z0-9-]+$/);
const text = z.string().trim().min(1);
const seconds = z.number().min(0);

/** Todo texto visível ao jogador existe nos dois idiomas; faltar um deles reprova o conteúdo. */
function localized(inner: z.ZodString = text) {
  return z.strictObject(Object.fromEntries(LOCALES.map((locale) => [locale, inner])) as Record<
    (typeof LOCALES)[number],
    z.ZodString
  >);
}

const localizedText = localized();

export const componentTypeSchema = z.enum(COMPONENT_TYPES);
export const costTierSchema = z.enum(COST_TIERS);
export const metricIdSchema = z.enum(METRIC_IDS);

export const componentSpecSchema = z.strictObject({
  capacityRps: z.number().min(0),
  baseLatencyMs: z.number().min(0),
  costTier: costTierSchema,
  bufferSize: z.number().int().min(0),
  params: z.record(z.string(), z.number()).default({}),
});

const boardNodeSchema = z.strictObject({
  id: slug,
  type: componentTypeSchema,
  spec: componentSpecSchema,
  position: z.strictObject({ x: z.number(), y: z.number() }),
  locked: z.boolean().optional(),
  paletteId: slug.optional(),
});

const boardEdgeSchema = z.strictObject({ id: z.string().min(1), from: slug, to: slug });

export const boardSchema = z.strictObject({
  nodes: z.array(boardNodeSchema).min(1),
  edges: z.array(boardEdgeSchema),
});

/** Uma peça da paleta. O mesmo tipo pode aparecer em variantes (ex.: réplica rápida e réplica barata). */
export const paletteItemSchema = z.strictObject({
  id: slug,
  type: componentTypeSchema,
  label: localizedText,
  spec: componentSpecSchema,
  max: z.number().int().positive(),
});

export const trafficSchema = z
  .strictObject({
    baseRps: z.number().positive(),
    mix: z.strictObject({ read: z.number().min(0), write: z.number().min(0), bot: z.number().min(0) }),
    keyspace: z.number().int().positive().optional(),
  })
  .refine((traffic) => Math.abs(traffic.mix.read + traffic.mix.write + traffic.mix.bot - 1) < 1e-9, {
    message: 'O mix read + write + bot deve somar 1.',
    path: ['mix'],
  });

const eventBase = { atSec: seconds, conceptId: slug };
const duration = { durationSec: seconds.optional() };
const nodeTarget = {
  nodeId: slug.optional(),
  nodeType: componentTypeSchema.optional(),
  count: z.number().int().positive().optional(),
};

/** Para adicionar um evento: crie o handler no motor e inclua o schema dos parâmetros nesta união. */
export const eventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...eventBase,
    type: z.literal('traffic_ramp'),
    params: z.strictObject({ toRps: z.number().positive(), ...duration }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('traffic_spike'),
    params: z.strictObject({ multiplier: z.number().positive(), durationSec: seconds }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('bot_wave'),
    params: z.strictObject({ rps: z.number().positive(), durationSec: seconds }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('node_failure'),
    params: z.strictObject({ ...nodeTarget, ...duration }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('network_partition'),
    params: z.strictObject({ fromId: slug, toId: slug, ...duration }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('client_retry'),
    params: z.strictObject({
      timeoutMs: z.number().positive(),
      maxRetries: z.number().int().positive().optional(),
      ...duration,
    }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('disk_failure'),
    params: z.strictObject({ ...nodeTarget, lossWindowMs: z.number().min(0).optional(), ...duration }),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('cache_flush'),
    params: z.strictObject({ ...nodeTarget, warmupSec: seconds.optional() }),
  }),
]);

export type LevelEvent = z.infer<typeof eventSchema>;

const EVENTS_REQUIRING_TARGET: readonly LevelEvent['type'][] = ['node_failure', 'disk_failure'];

export const sloSchema = z
  .strictObject({
    metric: metricIdSchema,
    op: z.enum(['lte', 'gte']),
    value: z.union([z.number(), costTierSchema]),
  })
  .refine((slo) => (slo.metric === 'costTier') === (typeof slo.value === 'string'), {
    message: 'costTier compara com low/mid/high; as outras métricas, com número.',
    path: ['value'],
  });

export const questionSchema = z
  .strictObject({
    id: slug,
    conceptId: slug,
    prompt: localizedText,
    options: z
      .array(z.strictObject({ id: slug, text: localizedText }))
      .min(3)
      .max(4),
    correctOptionId: slug,
    /** Curta de propósito: aparece só depois da resposta. */
    explanation: localized(text.max(EXPLANATION_MAX_CHARS)),
  })
  .superRefine((question, ctx) => {
    const ids = question.options.map((option) => option.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Opções com id repetido.', path: ['options'] });
    }
    if (!ids.includes(question.correctOptionId)) {
      ctx.addIssue({ code: 'custom', message: 'A resposta certa não está entre as opções.', path: ['correctOptionId'] });
    }
  });

export type Question = z.infer<typeof questionSchema>;

const questionPool = z.array(questionSchema).min(1);

const levelShape = z.strictObject({
  schemaVersion: z.literal(LEVEL_SCHEMA_VERSION),
  id: slug,
  title: localizedText,
  briefing: z.strictObject({ text: localizedText, requirements: z.array(localizedText).min(1) }),
  /** Conceitos trabalhados na fase. */
  concepts: z.array(slug).min(1),
  initialBoard: boardSchema,
  availableComponents: z.array(paletteItemSchema).min(1),
  traffic: trafficSchema,
  events: z.array(eventSchema),
  slos: z.array(sloSchema).min(1),
  costBudget: z.strictObject({ low: z.number().positive(), mid: z.number().positive() }).optional(),
  durationSec: z.number().positive(),
  seed: z.number().int(),
  /** Andaimes: rótulos nas peças, dicas disponíveis e conceitos da fase à mostra. */
  scaffolding: z.strictObject({ labels: z.boolean(), hints: z.boolean(), showConcepts: z.boolean() }),
  hints: z.array(localizedText).default([]),
  /** Fase que só abre algum tempo depois de outra ser concluída. */
  unlock: z.strictObject({ afterLevel: slug, delayHours: z.number().min(0) }).optional(),
  /**
   * Cada etapa tem um banco de perguntas: o jogo reveza entre elas, então errar e
   * tentar de novo não repete a mesma pergunta.
   */
  predictQuestions: questionPool,
  /** Indexadas pela métrica cujo SLO foi violado. */
  diagnoseQuestions: z.partialRecord(metricIdSchema, questionPool),
  justifyQuestions: questionPool,
});

type LevelShape = z.infer<typeof levelShape>;

function checkBoard(level: LevelShape, ctx: z.RefinementCtx): Set<string> {
  const nodeIds = new Set<string>();
  level.initialBoard.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      ctx.addIssue({ code: 'custom', message: `Nó repetido: ${node.id}`, path: ['initialBoard', 'nodes', index, 'id'] });
    }
    nodeIds.add(node.id);
  });
  const edgeIds = new Set<string>();
  level.initialBoard.edges.forEach((edge, index) => {
    const path = ['initialBoard', 'edges', index];
    if (edgeIds.has(edge.id)) ctx.addIssue({ code: 'custom', message: `Aresta repetida: ${edge.id}`, path });
    edgeIds.add(edge.id);
    for (const end of [edge.from, edge.to]) {
      if (!nodeIds.has(end)) ctx.addIssue({ code: 'custom', message: `Aresta aponta para nó inexistente: ${end}`, path });
    }
  });
  return nodeIds;
}

function checkEvents(level: LevelShape, nodeIds: ReadonlySet<string>, ctx: z.RefinementCtx): void {
  level.events.forEach((event, index) => {
    const path = ['events', index];
    if (event.atSec > level.durationSec) {
      ctx.addIssue({ code: 'custom', message: 'Evento agendado depois do fim da fase.', path: [...path, 'atSec'] });
    }
    const params: Record<string, unknown> = event.params;
    const hasTarget = params.nodeId !== undefined || params.nodeType !== undefined;
    if (EVENTS_REQUIRING_TARGET.includes(event.type) && !hasTarget) {
      ctx.addIssue({ code: 'custom', message: 'Informe nodeId ou nodeType.', path: [...path, 'params'] });
    }
    // Eventos só podem citar por id peças do tabuleiro inicial: as do jogador não têm id conhecido.
    for (const key of ['nodeId', 'fromId', 'toId']) {
      const nodeId = params[key];
      if (typeof nodeId === 'string' && !nodeIds.has(nodeId)) {
        ctx.addIssue({ code: 'custom', message: `Nó inexistente no tabuleiro inicial: ${nodeId}`, path: [...path, 'params', key] });
      }
    }
  });
}

function checkQuestions(level: LevelShape, ctx: z.RefinementCtx): void {
  const concepts = new Set(level.concepts);
  const pools: (readonly [readonly (string | number)[], readonly Question[]])[] = [
    [['predictQuestions'], level.predictQuestions],
    ...Object.entries(level.diagnoseQuestions).map(
      ([metric, pool]) => [['diagnoseQuestions', metric], pool ?? []] as const,
    ),
    [['justifyQuestions'], level.justifyQuestions],
  ];
  const seenIds = new Set<string>();
  for (const [poolPath, pool] of pools) {
    pool.forEach((question, index) => {
      const path = [...poolPath, index];
      if (!concepts.has(question.conceptId)) {
        ctx.addIssue({ code: 'custom', message: `Conceito fora da fase: ${question.conceptId}`, path: [...path, 'conceptId'] });
      }
      if (seenIds.has(question.id)) {
        ctx.addIssue({ code: 'custom', message: `Pergunta com id repetido: ${question.id}`, path: [...path, 'id'] });
      }
      seenIds.add(question.id);
    });
  }
  level.justifyQuestions.forEach((question, index) => {
    if (question.options.length !== JUSTIFY_OPTION_COUNT) {
      ctx.addIssue({
        code: 'custom',
        message: `A pergunta de justificativa tem exatamente ${JUSTIFY_OPTION_COUNT} opções.`,
        path: ['justifyQuestions', index, 'options'],
      });
    }
  });
  level.slos.forEach((slo, index) => {
    if (!level.diagnoseQuestions[slo.metric]) {
      ctx.addIssue({
        code: 'custom',
        message: `Falta a pergunta de diagnóstico para ${slo.metric}.`,
        path: ['slos', index, 'metric'],
      });
    }
  });
}

export const levelSchema = levelShape.superRefine((level, ctx) => {
  const nodeIds = checkBoard(level, ctx);
  checkEvents(level, nodeIds, ctx);
  checkQuestions(level, ctx);

  const concepts = new Set(level.concepts);
  level.events.forEach((event, index) => {
    if (!concepts.has(event.conceptId)) {
      ctx.addIssue({ code: 'custom', message: `Conceito fora da fase: ${event.conceptId}`, path: ['events', index, 'conceptId'] });
    }
  });
  const paletteIds = level.availableComponents.map((item) => item.id);
  if (new Set(paletteIds).size !== paletteIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Peças da paleta com id repetido.', path: ['availableComponents'] });
  }
});

export type Level = z.infer<typeof levelSchema>;
export type PaletteItem = z.infer<typeof paletteItemSchema>;

export const contentIndexSchema = z
  .strictObject({
    concepts: z.array(z.strictObject({ id: slug, name: localizedText })).min(1),
    levels: z.array(z.strictObject({ id: slug, title: localizedText, file: z.string().regex(/^levels\/[a-z0-9-]+\.json$/) })).min(1),
  })
  .superRefine((index, ctx) => {
    for (const key of ['concepts', 'levels'] as const) {
      const ids = index[key].map((entry) => entry.id);
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Ids repetidos.', path: [key] });
    }
  });

export type ContentIndex = z.infer<typeof contentIndexSchema>;
export type LevelEntry = ContentIndex['levels'][number];
export type ConceptEntry = ContentIndex['concepts'][number];
