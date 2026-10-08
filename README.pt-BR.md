# PlaySysDesigner

*[English](README.md)*

Jogo de system design no estilo tower defense. Você monta uma arquitetura, roda tráfego simulado em cima dela e vê o que quebra. O objetivo é **fixar conceitos**, não simular com precisão: toda mecânica existe para obrigar você a lembrar ou raciocinar, e a simulação só é fiel até o ponto em que o conceito fica visível.

Não é ferramenta de produção nem simulador de capacidade.

**Jogar:** https://digomes87.github.io/PlaySysDesigner/

O jogo está disponível em português e inglês; troque o idioma no cabeçalho.

## Como rodar

Requer Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173/PlaySysDesigner/
npm test           # testes do motor, do conteúdo e do progresso (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + build de produção em dist/
npm run preview    # serve o build
```

## Como publicar

O workflow `.github/workflows/deploy.yml` roda os testes, faz o build e publica no GitHub Pages a cada push na `main`.

O `base` do Vite vem de `VITE_BASE`, que o workflow define como `/<nome-do-repo>/`. Para publicar em outro caminho, rode `VITE_BASE=/ npm run build`. As rotas usam `HashRouter`, então não é preciso `404.html`.

## O loop de cada fase

Cada fase segue cinco passos, nesta ordem. Só o terceiro é simulação; os outros são perguntas, porque é respondendo que o conceito fixa.

1. **Prever** — você vê o sistema inicial e responde o que quebra primeiro.
2. **Montar** — arrasta componentes e conexões para o tabuleiro.
3. **Rodar** — o tráfego passa pela arquitetura; um placar mostra as métricas.
4. **Diagnosticar** — se falhou, o jogo não explica: mostra as métricas e pergunta a causa. A explicação só vem depois da resposta.
5. **Justificar** — se venceu, pergunta por que funcionou. Pega quem acertou por tentativa e erro.

Cada pergunta é ligada a um conceito e alimenta a repetição espaçada.

## Fases

1. **Um servidor não basta** — escala horizontal e balanceamento de carga.
2. **O banco está derretendo** — cache, réplicas de leitura e lag de replicação.
3. **Black Friday** — fila assíncrona e rate limiting.
4. **Revisão** — tudo isso num sistema diferente, sem rótulos e sem dicas. Só libera um dia depois da fase 3.

## Arquitetura

O projeto reaproveita a arquitetura do [PlayKids](https://github.com/digomes87/PlayKids): motor em TypeScript puro, conteúdo em JSON validado por schema, um renderer por tipo e progresso atrás de uma interface de repositório.

```
src/
  engine/       Motor em TypeScript puro: ticks, roteamento, capacidade, métricas, SLOs.
                Sem React e sem DOM.
    components/ Um comportamento por tipo de componente + o mapa tipo -> comportamento.
    events/     Um handler por tipo de evento + o mapa tipo -> handler.
  content/      Schema zod das fases, carregamento e operações de tabuleiro.
  progress/     Interface ProgressRepository, implementação IndexedDB,
                repetição espaçada, desbloqueio de fases, exportar/importar JSON.
  i18n/         Idiomas e os dicionários tipados da interface (pt-BR, en).
  renderers/    Desenho e ficha de cada tipo de componente + o mapa tipado.
  board/        Tabuleiro (@xyflow/react), peças, partículas de tráfego, paleta.
  game/         Máquina do loop, execução da simulação, placar, tela da fase.
  loop/         Pergunta usada em prever, diagnosticar e justificar.
  home/         Lista de fases.
  review/       Tela de progresso: conceitos, revisões vencidas, seus dados.
  app/          Shell: rotas, cabeçalho, seletor de idioma.
public/content/ index.json e um arquivo JSON por fase.
```

Restrições, iguais às do PlayKids: site 100% estático, sem backend, sem analytics, sem SDKs de terceiros e sem CDN. As fontes vão junto com o site. O progresso fica só no aparelho.

## O motor

- **Tempo discreto**: um tick vale 100 ms.
- **Determinístico**: o PRNG (mulberry32) recebe a seed da fase. Mesma seed e mesmo tabuleiro dão a mesma partida, tick a tick.
- **Headless**: `runToEnd(config)` roda a partida inteira e devolve o resultado; `createSimulation(config).step()` avança um tick e devolve o retrato que a interface anima.

### Componentes

Cada componente tem `capacityRps`, `baseLatencyMs`, `costTier` e `bufferSize`, mais parâmetros próprios do tipo.

| Tipo | O que faz |
|------|-----------|
| `traffic_source` | Origem das requisições. Tem uma única saída. |
| `load_balancer` | Reparte o tráfego entre saídas iguais. |
| `app_server` | Processa e encaminha para a camada de dados. |
| `cache` | Responde leituras com probabilidade `hitRate`; o miss segue para o banco. |
| `db_primary` | Grava escritas e responde leituras sempre atualizadas. |
| `db_replica` | Só leitura; fica `replicationLagMs` atrás do primário. |
| `queue` | Confirma a escrita ao cliente na hora e guarda o trabalho. |
| `worker` | Leva trabalhos da fila ao banco, no ritmo da própria capacidade. |
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

Cada fase define SLOs sobre essas métricas. Vence quem cumpre todos durante a partida inteira: `p99LatencyMs` e `errorRate` são avaliados numa janela deslizante de 5 segundos, a partir do momento em que ela tem pelo menos 10 respostas; as demais são acumuladas.

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

## Repetição espaçada

O progresso é derivado do registro de respostas, nunca guardado como pontuação.

- Por conceito: `new`, `practicing` ou `mastered`, mais a data da próxima revisão.
- Os intervalos de revisão são 1, 3, 7 e 16 dias. Acertar avança um intervalo, mas só quando a revisão está vencida; errar volta para 1 dia.
- Um conceito fica `mastered` depois de acertos em pelo menos duas fases diferentes, com pelo menos 3 dias entre o primeiro acerto e o acerto na outra fase. Errar depois derruba o domínio até o conceito ser acertado de novo.

A medida de sucesso é retenção atrasada, não estrelas.

## Como adicionar uma fase

1. Crie `public/content/levels/<id>.json` seguindo o `levelSchema` (`src/content/schema.ts`). Todo texto visível ao jogador é um objeto com `pt-BR` e `en`.
2. Registre a fase em `public/content/index.json`.
3. Inclua uma solução de referência, e os atalhos tentadores que a fase precisa reprovar, em `src/content/referenceSolutions.ts`.
4. Rode `npm test`. Um teste valida todo o conteúdo publicado contra o schema e roda cada fase headless: o tabuleiro inicial precisa falhar, a solução de referência precisa passar, e cada atalho precisa reprovar na métrica que ele existe para ensinar.

## Como adicionar um componente

O motor trata o tipo de componente como dado: o núcleo cuida de capacidade, buffer, latência e roteamento, e não conhece nenhum tipo pelo nome.

1. Inclua o tipo em `COMPONENT_TYPES` (`src/engine/types.ts`).
2. Crie `src/engine/components/<tipo>.ts` exportando um `ComponentBehavior`: a prioridade de roteamento, o que o componente aceita e o que faz com cada requisição (`forward`, `respond`, `ack` ou `drop`).
3. Registre em `BEHAVIORS` (`src/engine/components/registry.ts`) e em `RENDERERS` (`src/renderers/registry.tsx`), e dê um nome a ele nos dois dicionários em `src/i18n/`. Os três mapas são tipados por `ComponentType`: enquanto o tipo novo não for registrado em todos, o projeto não compila.

Eventos seguem o mesmo padrão, com `SIM_EVENT_TYPES`, `EVENT_HANDLERS` (`src/engine/events/registry.ts`) e o schema de parâmetros em `eventSchema`.

## Stack

Vite, React, TypeScript, Zustand, zod, Vitest e @xyflow/react.
