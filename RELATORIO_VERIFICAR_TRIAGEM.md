# Rota `/api/chatapp/verificar-triagem` — status atual + dúvidas

> Texto pronto para colar no ChatGPT. Resume o que foi feito, a descoberta de
> roteamento que travava tudo, as decisões aplicadas e o que ainda preciso decidir.

---

## Contexto

Projeto Vercel já existente: um **proxy somente-leitura do Pipedrive** (Node 20).
Preciso de uma rota GET que o **ChatApp** chama para decidir se inicia o bot de
**Triagem**:

- Cliente **já está** em esteira de **Análise de Crédito** ou **Pós arrematação** →
  Triagem **NÃO** inicia.
- Caso contrário → Triagem inicia.

O ChatApp passa `id_chat` (telefone, pode vir sem o 9º dígito).

---

## ⚠️ Descoberta importante de roteamento (a causa do bug)

A função isolada (`api/chatapp/verificar-triagem.mjs`) **nunca era alcançada** em
produção. Ao testar a URL, a resposta vinha do proxy (`unsupported_route` /
`unauthorized`, com header `x-proxy-runtime`).

Diagnóstico (confirmado por testes na URL de produção):
- **Existe um catch-all global no projeto** que envia **TODO** o tráfego para
  `api/proxy.mjs`. Provei isso porque até `/foo/bar` (fora de `/api`) responde com
  `x-proxy-runtime: vercel-node-fetch`.
- Esse catch-all **NÃO está no `vercel.json`** (conferi a versão atual e todo o
  histórico do git). Logo, está no **nível do projeto na Vercel** — provavelmente um
  deploy antigo feito via CLI com `routes: [{ "src": "/(.*)", "dest": "/api/proxy" }]`,
  ou uma config no dashboard. Esse tipo de `routes` legado **tem prioridade sobre o
  roteamento por arquivos**, então sobrepõe qualquer função nova em `api/`.

**Consequência:** enquanto esse catch-all existir, qualquer arquivo novo em `api/`
é ignorado e tudo cai no proxy.

### Solução adotada
Em vez de brigar com o catch-all, fiz o **próprio proxy reconhecer e servir** a rota
`/api/chatapp/verificar-triagem`, delegando para um **módulo isolado**
(`lib/chatapp-triagem.js`). Isso:
- funciona com o roteamento atual (tudo passa pelo proxy);
- **não altera o comportamento de nenhum endpoint existente** (só adiciona um path,
  tratado ANTES do auth do proxy porque a Triagem usa token próprio);
- mantém a lógica isolada e testável num módulo separado.

Confirmei localmente: `handleProxyRequest("/api/chatapp/verificar-triagem")` sem token
retorna `401 {"error":"unauthorized"}` (resposta da Triagem, não do proxy). ✔

> **Pergunta pro GPT:** faz sentido manter assim (rota servida pelo proxy), ou vale a
> pena localizar e remover o catch-all global na Vercel para servir a função isolada
> de forma "pura"? Há risco de remover o catch-all e quebrar algum atalho legado
> (`/exec`, `/`, etc.)? *(Obs.: os atalhos `/`, `/health`, `/exec`, `/api/v2/*`, `/v1/*`
> já estão cobertos por `rewrites` no `vercel.json`, então o catch-all parece
> redundante — mas quero confirmar antes de mexer.)*

---

## Arquivos criados / alterados

| Arquivo | O quê |
|---|---|
| `lib/chatapp-triagem.js` | **(novo)** Lógica isolada: auth do ChatApp, variações de telefone, matching, classificação, montagem da resposta. Recebe um `searchDeals(term)` injetado. |
| `lib/pipedrive-live-proxy.js` | **(alterado)** +1 branch em `dispatchProxyRequest_` para o path do ChatApp (antes do auth) + helper `internalSearchDeals_` que reusa `/api/v2/deals/search`. Endpoints existentes intactos. |
| `api/chatapp/verificar-triagem.mjs` | **(alterado)** Wrapper fino que reusa o mesmo módulo (entrada direta, caso o catch-all seja removido no futuro). |
| `vercel.json` | **(alterado)** `maxDuration: 30` para a função nova. |
| `.env.example` | **(alterado)** Documenta as novas envs. |

---

## Decisões aplicadas (conforme combinado)

1. **Somente deals por enquanto**, com `TODO(leads)` no código (o proxy não expõe rota
   de leads). `cliente.tipo_item` fica `"deal"`.
2. **Todos os campos do payload sempre existem**, inclusive em erro (fail-safe) —
   strings vazias quando não há valor.
3. **Prioridade quando há múltiplos matches: Pós arrematação > Análise de Crédito.**
4. **Status permitido é configurável por esteira** via env (default `open`):
   `ALLOWED_STATUSES_ANALISE_CREDITO`, `ALLOWED_STATUSES_POS_ARREMATACAO`.
5. **Erro de consulta → HTTP 200** com `triagem.necessaria = "sim"`.
6. **Token inválido → HTTP 401.**
7. **Nunca retorna payload bruto do Pipedrive** (apenas os campos do contrato).

---

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `CHATAPP_INTERNAL_TOKEN` | Token do ChatApp (query `?token=` ou header `Authorization: Bearer` / `X-Internal-Token`). Ausente/errado → 401. |
| `PIPEDRIVE_PROXY_API_TOKEN` | **Já existe.** Usado só pelo wrapper `.mjs` (entrada direta). Quando servido pelo proxy, a busca é interna e não precisa de token. |
| `PIPELINES_ANALISE_CREDITO` / `STAGES_ANALISE_CREDITO` | IDs (vírgula) da esteira Análise de Crédito. `pipeline_id` OU `stage_id` já classifica. |
| `PIPELINES_POS_ARREMATACAO` / `STAGES_POS_ARREMATACAO` | IDs (vírgula) da esteira Pós arrematação. |
| `ALLOWED_STATUSES_ANALISE_CREDITO` | Status aceitos (vírgula). Default `open`. Ex.: `open,won`. |
| `ALLOWED_STATUSES_POS_ARREMATACAO` | Idem para Pós arrematação. |

Como achar os IDs: `GET /api/v2/pipelines` e `GET /api/v2/stages` no proxy (com `api_token`).

---

## Contrato

**Request:**
```
GET /api/chatapp/verificar-triagem?id_chat=<telefone>&token=<CHATAPP_INTERNAL_TOKEN>
```

**Resposta (estrutura fixa):**
```ts
{
  triagem:  { necessaria: "sim" | "nao", motivo: string },
  cliente:  { telefone: string, processo: "" | "Análise de Crédito" | "Pós arrematação",
              tipo_item: "" | "deal" | "lead", item_id: string, titulo: string },
  chatapp:  { nota_funcionario: string },
  debug:    { matched_phone: string, matches_count: number, error?: string }
}
```

**JSONPaths usados pelo ChatApp:**
```
$.triagem.necessaria   $.triagem.motivo
$.cliente.processo      $.cliente.tipo_item   $.cliente.item_id   $.cliente.titulo
$.chatapp.nota_funcionario
$.debug.matched_phone   $.debug.matches_count
```

| necessaria | motivo | quando |
|---|---|---|
| `nao` | `cliente_em_pos_arrematacao` | deal em Pós arrematação com status permitido |
| `nao` | `cliente_em_analise_credito` | deal em Análise de Crédito com status permitido |
| `sim` | `cliente_nao_encontrado_em_esteira` | nada encontrado **ou** erro de consulta |

---

## Lógica (resumo)

1. Valida `CHATAPP_INTERNAL_TOKEN` → senão 401.
2. Normaliza `id_chat` (só dígitos).
3. Gera variações: original, com `+`, com/sem DDI `55`, com/sem 9º dígito.
4. Para cada variação, busca em `/api/v2/deals/search` (interno).
5. Filtra: confirma o campo **Telefone do Arrematante**
   (`534ddc592e7b7db4b6d6faff0d07f2071684039e`) batendo de verdade + status permitido
   por esteira.
6. Escolhe o match de maior prioridade (Pós > Análise).
7. Monta a resposta. Qualquer erro → fail-safe (`sim` + `debug.error`).

---

## Exemplos de payload

### A) Cliente em Pós arrematação → PULAR Triagem
`GET /api/chatapp/verificar-triagem?id_chat=553195611124&token=MINHA_CHAVE`
```json
{
  "triagem": { "necessaria": "nao", "motivo": "cliente_em_pos_arrematacao" },
  "cliente": {
    "telefone": "5531995611124",
    "processo": "Pós arrematação",
    "tipo_item": "deal",
    "item_id": "67890",
    "titulo": "Maria Souza - Apartamento Centro"
  },
  "chatapp": {
    "nota_funcionario": "/Cliente já está em Pós arrematação no Pipedrive. Não iniciar Triagem. Assumir atendimento pela esteira atual.\n\nTelefone identificado: 5531995611124\nTipo: deal\nID Pipedrive: 67890\nTítulo: Maria Souza - Apartamento Centro"
  },
  "debug": { "matched_phone": "5531995611124", "matches_count": 1 }
}
```
> `id_chat` veio **sem** o 9; o match foi na variante **com** o 9.

### B) Cliente em Análise de Crédito → PULAR Triagem
```json
{
  "triagem": { "necessaria": "nao", "motivo": "cliente_em_analise_credito" },
  "cliente": {
    "telefone": "5531995611124",
    "processo": "Análise de Crédito",
    "tipo_item": "deal",
    "item_id": "12345",
    "titulo": "João Silva - Análise de Crédito"
  },
  "chatapp": {
    "nota_funcionario": "/Cliente já está em Análise de Crédito no Pipedrive. Não iniciar Triagem. Assumir atendimento pela esteira atual.\n\nTelefone identificado: 5531995611124\nTipo: deal\nID Pipedrive: 12345\nTítulo: João Silva - Análise de Crédito"
  },
  "debug": { "matched_phone": "5531995611124", "matches_count": 1 }
}
```

### C) Não encontrado em esteira → INICIAR Triagem
```json
{
  "triagem": { "necessaria": "sim", "motivo": "cliente_nao_encontrado_em_esteira" },
  "cliente": { "telefone": "", "processo": "", "tipo_item": "", "item_id": "", "titulo": "" },
  "chatapp": { "nota_funcionario": "" },
  "debug": { "matched_phone": "", "matches_count": 0 }
}
```

### D) Erro de consulta → INICIAR Triagem (fail-safe, HTTP 200)
```json
{
  "triagem": { "necessaria": "sim", "motivo": "cliente_nao_encontrado_em_esteira" },
  "cliente": { "telefone": "", "processo": "", "tipo_item": "", "item_id": "", "titulo": "" },
  "chatapp": { "nota_funcionario": "" },
  "debug": { "matched_phone": "", "matches_count": 0, "error": "Falha na consulta ao proxy (status 502)." }
}
```

### E) Token inválido → HTTP 401
```json
{ "error": "unauthorized" }
```

---

## O que ainda preciso decidir / validar (perguntas pro GPT)

1. **Catch-all:** manter a rota servida pelo proxy (atual) ou remover o catch-all
   global da Vercel para servir a função isolada? Risco de quebrar algo legado?
2. **Campo "Telefone do Arrematante" é pesquisável no Pipedrive?** A busca usa
   `/deals/search` (fuzzy) e só encontra o deal se o campo estiver marcado como
   *searchable*. Se não estiver, nada é encontrado — aí precisaria varrer deals
   abertos e filtrar pelo campo (mais lento). **Como confirmar/configurar isso?**
3. **Status:** "Pós arrematação" pode ter deal `won`? Se sim, mudo a env para
   `open,won`. Hoje default é só `open`.
4. **`matches_count`:** hoje conta matches **dentro das esteiras-alvo** (0 quando a
   Triagem deve iniciar). Confirma que é o esperado pelo ChatApp?
5. **Leads:** vale estender o proxy para suportar leads, ou na prática cliente em
   esteira sempre é *deal*?
6. **Desempate:** hoje Pós > Análise; em empate dentro da mesma esteira, o primeiro
   encontrado. Precisa de outro critério (ex.: deal mais recente)?

---

## Próximos passos

- [ ] Preencher as envs de esteira (`PIPELINES_*`, `STAGES_*`) e `CHATAPP_INTERNAL_TOKEN`
      em Produção/Preview na Vercel.
- [ ] Fazer deploy do commit atual.
- [ ] Testar com um telefone real conhecido em cada esteira:
      `curl "https://SEU-DOMINIO.vercel.app/api/chatapp/verificar-triagem?id_chat=55XXXXXXXXXXX&token=MINHA_CHAVE"`
- [ ] Confirmar item 2 (campo pesquisável) — é o maior risco de "não encontrar nada".
```
