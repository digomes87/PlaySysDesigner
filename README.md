# PlaySysDesigner

Jogo de system design no estilo tower defense. O jogador monta uma arquitetura, roda tráfego simulado em cima dela e vê o que quebra. O objetivo é **fixar conceitos**, não simular com precisão: toda mecânica existe para obrigar o jogador a lembrar ou raciocinar, e a simulação só é fiel até o ponto em que o conceito fica visível.

Não é ferramenta de produção nem simulador de capacidade.

**Abrir:** https://digomes87.github.io/PlaySysDesigner/ (por enquanto só uma página provisória)

## Estado do projeto

Em construção. O que já existe é o motor de simulação, sem interface.

| Etapa | Estado |
|-------|--------|
| Motor de simulação headless + testes | Pronto |
| Schema das fases (zod) + conteúdo das 4 fases | A fazer |
| Progresso, domínio por conceito e repetição espaçada | A fazer |
| Interface: tabuleiro, simulação animada, telas do loop | A fazer |
| Deploy no GitHub Pages | Pronto |

Por enquanto `npm run dev` abre só uma página provisória. O que dá para exercitar é o motor, pelos testes.

## Como rodar

Requer Node 22+.

```bash
npm install
npm test           # testes do motor (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + build de produção em dist/
npm run dev        # http://localhost:5173/PlaySysDesigner/
```

## Como publicar

O workflow `.github/workflows/deploy.yml` roda os testes, faz o build e publica no GitHub Pages a cada push na `main`.

O `base` do Vite vem de `VITE_BASE`, que o workflow define como `/<nome-do-repo>/`. Para publicar em outro caminho, rode `VITE_BASE=/ npm run build`.

## O loop de cada fase

Cada fase segue cinco passos, nesta ordem. Só o terceiro é simulação; os outros são perguntas, porque é respondendo que o conceito fixa.

1. **Prever** — o jogador vê o sistema inicial e responde o que quebra primeiro.
2. **Montar** — arrasta componentes e conexões no tabuleiro.
3. **Rodar** — o tráfego passa pela arquitetura; um painel mostra as métricas.
4. **Diagnosticar** — se falhou, o jogo não explica: mostra as métricas e pergunta a causa. A explicação só vem depois da resposta.
5. **Justificar** — se venceu, pergunta por que funcionou. Pega quem acertou por tentativa e erro.

Cada pergunta é ligada a um conceito e alimenta a repetição espaçada.

## Arquitetura

O projeto reaproveita a arquitetura do [PlayKids](https://github.com/digomes87/PlayKids): motor em TypeScript puro, conteúdo em JSON validado por schema, um renderer por tipo e progresso atrás de uma interface de repositório.

```
src/
  engine/       Motor em TypeScript puro: ticks, roteamento, capacidade, métricas, SLOs.
                Sem React e sem DOM.
    components/ Um comportamento por tipo de componente + o mapa tipo -> comportamento.
    events/     Um handler por tipo de evento + o mapa tipo -> handler.
  app/          Shell da aplicação (provisório).
```

Pastas previstas para as próximas etapas: `content/` (schema e carregamento das fases), `progress/` (repositório IndexedDB e repetição espaçada), `renderers/`, `board/`, `game/`, `loop/`, `home/` e `review/`.

Restrições, iguais às do PlayKids: site 100% estático, sem backend, sem analytics, sem SDKs de terceiros e sem CDN. O progresso fica só no aparelho.

## O motor

- **Tempo discreto**: um tick vale 100 ms.
- **Determinístico**: o PRNG (mulberry32) recebe a seed da fase. Mesma seed e mesmo tabuleiro dão a mesma partida, tick a tick.
- **Headless**: `runToEnd(config)` roda a partida inteira e devolve o resultado; `createSimulation(config).step()` avança um tick e devolve o retrato que a interface vai animar.

### Componentes

Cada componente tem `capacityRps`, `baseLatencyMs`, `costTier` e `bufferSize`, mais parâmetros próprios do tipo.

| Tipo | O que faz |
|------|-----------|
| `traffic_source` | Origem das requisições. |
| `load_balancer` | Reparte o tráfego entre saídas iguais. |
| `app_server` | Processa e encaminha para a camada de dados. |
| `cache` | Responde leituras com probabilidade `hitRate`; o miss segue para o banco. |
| `db_primary` | Grava escritas e responde leituras sempre atualizadas. |
| `db_replica` | Só leitura; fica `replicationLagMs` atrás do primário. |
| `queue` | Confirma a escrita ao cliente na hora e guarda o trabalho. |
| `worker` | Tira trabalhos da fila e leva ao banco, no ritmo da própria capacidade. |
| `rate_limiter` | Deixa passar até `limitRps` de bots e descarta o resto. |

### Capacidade e latência

A latência de um componente é `base / (1 - utilização)`, limitada a 20 vezes a base. A utilização usada é a do tick anterior. Quando a demanda passa da capacidade, o excedente espera no buffer até `bufferSize`; o que não cabe é descartado e conta como erro.

### Roteamento

As conexões não têm portas nomeadas. Ao encaminhar uma requisição, o nó olha as saídas que aceitam aquele tipo, fica com o grupo de maior prioridade e reveza (round-robin) só dentro dele:

- **Leitura**: cache > réplica > primário.
- **Escrita**: fila > primário.

Assim, um app server ligado a um cache e a um primário manda todas as leituras para o cache, e não metade para cada. Se o nó preferido está fora do ar, o tráfego cai para o próximo grupo.

### Tipos de requisição

`read`, `write` e `bot`, na proporção definida pela fase. Bots consomem capacidade e sempre furam o cache, mas não entram na taxa de erro nem na latência.

### Métricas

| Métrica | Significado |
|---------|-------------|
| `p99LatencyMs` | Latência do percentil 99. |
| `errorRate` | Fração das requisições legítimas que falharam. |
| `availability` | Fração dos segundos com taxa de erro de até 5%. |
| `costTier` | Faixa de custo do tabuleiro (`low`, `mid`, `high`). |
| `staleReads` | Leituras feitas numa réplica dentro da janela de lag após uma escrita na mesma chave. |
| `duplicateOps` | Escritas gravadas mais de uma vez (retry de uma operação que já tinha sido gravada). |
| `lostWrites` | Escritas descartadas, ou confirmadas ao cliente e perdidas depois. |

Cada fase define SLOs sobre essas métricas. Vence quem cumpre todos durante a partida inteira: `p99LatencyMs` e `errorRate` são avaliados numa janela deslizante de 5 segundos; as demais são acumuladas.

### Eventos

Eventos são agendados por tempo e mexem no tráfego ou nos nós.

| Evento | Efeito |
|--------|--------|
| `traffic_ramp` | Leva o tráfego até `toRps` de forma linear. |
| `traffic_spike` | Multiplica o tráfego por um período. |
| `bot_wave` | Soma tráfego de bot por um período. |
| `node_failure` | Tira nós do ar; o que estava no buffer se perde. |
| `network_partition` | Corta a ligação entre dois nós. |
| `client_retry` | O cliente reenvia o que falhou ou demorou demais, com o mesmo `opId`. |
| `disk_failure` | O nó sai do ar e perde o que guardava. |
| `cache_flush` | Esvazia o cache, que reaquece aos poucos. |

## Como adicionar um componente

O motor trata o tipo de componente como dado: o núcleo cuida de capacidade, buffer, latência e roteamento, e não conhece nenhum tipo pelo nome.

1. Inclua o tipo em `COMPONENT_TYPES` (`src/engine/types.ts`).
2. Crie `src/engine/components/<tipo>.ts` exportando um `ComponentBehavior`: a prioridade de roteamento, o que o componente aceita e o que faz com cada requisição (`forward`, `respond`, `ack` ou `drop`).
3. Registre em `BEHAVIORS` (`src/engine/components/registry.ts`). O mapa é tipado por `ComponentType`: enquanto o comportamento não for registrado, o projeto não compila.

Eventos seguem o mesmo padrão, com `SIM_EVENT_TYPES` e `EVENT_HANDLERS` (`src/engine/events/registry.ts`).

## Fases previstas

1. **Um servidor não basta** — escala horizontal e balanceamento de carga.
2. **O banco está derretendo** — cache, réplicas de leitura e lag de replicação.
3. **Black Friday** — fila assíncrona e rate limiting.
4. **Revisão** — mistura tudo num sistema diferente, sem rótulos e sem dicas. Só libera um dia depois da fase 3.

## Stack

Vite, React, TypeScript, Zustand, zod, Vitest e @xyflow/react.
