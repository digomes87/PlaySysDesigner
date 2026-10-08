# PlaySysDesigner

*[Português](README.pt-BR.md)*

A system design game in the spirit of tower defense. You build an architecture, run simulated traffic through it and watch what breaks. The goal is to **make concepts stick**, not to simulate accurately: every mechanic exists to force you to recall or reason, and the simulation is only as faithful as it needs to be for the concept to become visible.

It is not a production tool or a capacity simulator.

**Play:** https://digomes87.github.io/PlaySysDesigner/

The game is available in English and Portuguese; switch languages in the header.

## Running it

Requires Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173/PlaySysDesigner/
npm test           # engine, content and progress tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build in dist/
npm run preview    # serve the build
```

## Publishing

The workflow in `.github/workflows/deploy.yml` runs the tests, builds and publishes to GitHub Pages on every push to `main`.

Vite's `base` comes from `VITE_BASE`, which the workflow sets to `/<repo-name>/`. To publish under another path, run `VITE_BASE=/ npm run build`. Routes use `HashRouter`, so no `404.html` is needed.

## The loop of each level

Every level follows five steps, in this order. Only the third one is simulation; the others are questions, because answering is what makes a concept stick.

1. **Predict** — you see the starting system and say what breaks first.
2. **Build** — drag components and connections onto the board.
3. **Run** — traffic flows through the architecture; a scoreboard shows the metrics.
4. **Diagnose** — if it failed, the game does not explain: it shows the metrics and asks for the cause. The explanation only comes after the answer.
5. **Justify** — if it passed, it asks why it worked. This catches wins by trial and error.

Every question is tied to a concept and feeds spaced repetition. Each step draws from a pool of questions and shows the one you saw longest ago, so failing and trying again brings a different question instead of letting you memorize the answer.

## Levels

1. **One server is not enough** — horizontal scaling and load balancing.
2. **The database is melting** — caching, read replicas and replication lag.
3. **Black Friday** — async queue and rate limiting.
4. **Review** — all of it in a different system, with no labels and no hints. It only unlocks one day after level 3.

## Architecture

The project reuses the architecture of [PlayKids](https://github.com/digomes87/PlayKids): an engine in plain TypeScript, content as schema-validated JSON, one renderer per type, and progress behind a repository interface.

```
src/
  engine/       Plain TypeScript engine: ticks, routing, capacity, metrics, SLOs.
                No React, no DOM.
    components/ One behavior per component type + the type -> behavior map.
    events/     One handler per event type + the type -> handler map.
  content/      zod schema for levels, loading, and board operations.
  progress/     ProgressRepository interface, IndexedDB implementation,
                spaced repetition, level unlocking, JSON export/import.
  i18n/         Locales and the typed interface dictionaries (pt-BR, en).
  renderers/    Glyph and spec lines per component type + the typed map.
  board/        Board canvas (@xyflow/react), nodes, traffic particles, palette.
  game/         Loop state machine, simulation runner, scoreboard, level screen.
  loop/         Question step shared by predict, diagnose and justify.
  home/         Level list.
  review/       Progress screen: concepts, overdue reviews, your data.
  app/          Shell: routes, header, language switch.
public/content/ index.json and one JSON file per level.
```

Constraints, the same as PlayKids: a 100% static site, no backend, no analytics, no third-party SDKs and no CDN. Fonts are bundled with the site. Progress stays on the device.

## The engine

- **Discrete time**: one tick is 100 ms.
- **Deterministic**: the PRNG (mulberry32) takes the level's seed. Same seed and same board give the same run, tick by tick.
- **Headless**: `runToEnd(config)` runs a whole match and returns the result; `createSimulation(config).step()` advances one tick and returns the snapshot the interface animates.

### Components

Every component has `capacityRps`, `baseLatencyMs`, `costTier` and `bufferSize`, plus parameters specific to its type.

| Type | What it does |
|------|--------------|
| `traffic_source` | Origin of the requests. It has a single output. |
| `load_balancer` | Splits traffic across equal outputs. |
| `app_server` | Processes and forwards to the data tier. |
| `cache` | Answers reads with probability `hitRate`; a miss goes on to the database. |
| `db_primary` | Stores writes and answers reads that are always fresh. |
| `db_replica` | Read only; it lags `replicationLagMs` behind the primary. |
| `queue` | Confirms the write to the client right away and holds the job. |
| `worker` | Takes jobs from the queue to the database, at its own capacity. |
| `rate_limiter` | Lets through up to `limitRps` of bots and drops the rest. |

### Capacity and latency

A component's latency is `base / (1 - utilization)`, capped at 20 times the base. The utilization used is the previous tick's. When demand exceeds capacity, the excess waits in the buffer up to `bufferSize`; whatever does not fit is dropped and counts as an error.

### Routing

Connections have no named ports. When forwarding a request, a node looks at the outputs that accept that kind, keeps the highest-priority group and round-robins only inside it:

- **Reads**: cache > replica > primary.
- **Writes**: queue > primary.

So an app server wired to a cache and to a primary sends every read to the cache, not half to each. If the preferred node is down, traffic falls to the next group.

### Request kinds

`read`, `write` and `bot`, in the proportion the level defines. Bots consume capacity and always pierce the cache, but they do not count toward error rate or latency.

### Metrics

| Metric | Meaning |
|--------|---------|
| `p99LatencyMs` | 99th percentile latency. |
| `errorRate` | Fraction of legitimate requests that failed. |
| `availability` | Fraction of seconds with an error rate of at most 5%. |
| `costTier` | Cost tier of the board (`low`, `mid`, `high`). |
| `staleReads` | Reads served by a replica inside the lag window after a write to the same key. |
| `duplicateOps` | Writes stored more than once (a retry of an operation that had already been stored). |
| `lostWrites` | Writes that were dropped, or confirmed to the client and lost afterwards. |

Each level defines SLOs over these metrics. You win by meeting all of them for the whole run: `p99LatencyMs` and `errorRate` are evaluated over a 5-second sliding window, once it holds at least 10 answers; the others are cumulative.

### Events

Events are scheduled by time and act on traffic or on nodes.

| Event | Effect |
|-------|--------|
| `traffic_ramp` | Takes traffic to `toRps` linearly. |
| `traffic_spike` | Multiplies traffic for a while. |
| `bot_wave` | Adds bot traffic for a while. |
| `node_failure` | Takes nodes down; whatever sat in their buffer is lost. |
| `network_partition` | Cuts the link between two nodes. |
| `client_retry` | Clients resend what failed or took too long, with the same `opId`. |
| `disk_failure` | The node goes down and loses what it stored. |
| `cache_flush` | Empties the cache, which warms up gradually. |

## Spaced repetition

Progress is derived from the log of answers, never stored as a score.

- Per concept: `new`, `practicing` or `mastered`, plus the date of the next review.
- Review intervals are 1, 3, 7 and 16 days. A correct answer advances one interval, but only when the review is due; a wrong one goes back to 1 day.
- A concept is `mastered` after correct answers in at least two different levels, with at least 3 days between the first correct answer and the one in the other level. A later wrong answer takes the mastery away until the concept is answered correctly again.

The measure of success is delayed retention, not stars.

## Adding a level

1. Create `public/content/levels/<id>.json` following `levelSchema` (`src/content/schema.ts`). Every player-facing string is an object with `pt-BR` and `en`.
2. Register it in `public/content/index.json`.
3. Add a reference solution, and the tempting shortcuts the level must reject, in `src/content/referenceSolutions.ts`.
4. Run `npm test`. A test validates all published content against the schema and runs each level headless: the starting board must fail, the reference solution must pass, and each shortcut must fail on the metric it is meant to teach.

## Adding a component

The engine treats the component type as data: the core handles capacity, buffer, latency and routing, and knows no type by name.

1. Add the type to `COMPONENT_TYPES` (`src/engine/types.ts`).
2. Create `src/engine/components/<type>.ts` exporting a `ComponentBehavior`: its routing priority, what it accepts and what it does with each request (`forward`, `respond`, `ack` or `drop`).
3. Register it in `BEHAVIORS` (`src/engine/components/registry.ts`) and in `RENDERERS` (`src/renderers/registry.tsx`), and name it in both dictionaries under `src/i18n/`. All three maps are typed by `ComponentType`: until the new type is registered everywhere, the project does not compile.

Events follow the same pattern, with `SIM_EVENT_TYPES`, `EVENT_HANDLERS` (`src/engine/events/registry.ts`) and the parameter schema in `eventSchema`.

## Stack

Vite, React, TypeScript, Zustand, zod, Vitest and @xyflow/react.
