# Relatório — Rota `/api/chatapp/verificar-triagem`

Relatório técnico para revisão externa (ex.: ChatGPT). Descreve o que foi implementado,
as decisões tomadas, os pontos em aberto e exemplos de payload para todos os cenários.

---

## 1. Objetivo

Criar uma rota **GET isolada** na Vercel que o **ChatApp** chama para decidir se deve ou
não iniciar o bot de **Triagem**.

Regra de negócio (CCA Smart):
- Se o cliente **já está** em uma esteira de **Análise de Crédito** ou **Pós arrematação**,
  a Triagem **NÃO** deve iniciar.
- Caso contrário, a Triagem **deve** iniciar normalmente.

O ChatApp passa `id_chat` (o telefone do cliente, extraído da URL do ChatApp). O número
pode vir **sem o nono dígito**, então a rota testa variações com e sem o 9.

---

## 2. Stack e contexto do projeto

- Projeto Vercel já existente: um **proxy somente-leitura** do Pipedrive.
- Linguagem: Node.js (>=20), funções Vercel.
- O proxy fica em `lib/pipedrive-live-proxy.js` (CommonJS) e é exposto por `api/proxy.mjs`.
- O proxy expõe a função `handleProxyRequest({ method, url, headers })` que retorna
  `{ status, body (string JSON), headers }`.
- O endpoint de busca usado é `GET /api/v2/deals/search`, que devolve deals já
  "enriquecidos" (formato *lean*) com `pipeline.id`, `stage.id`, `status`, `title` e
  `fields["Telefone do Arrematante"]`.

**Decisão de arquitetura:** a nova rota chama o proxy **in-process** (no mesmo processo,
sem ida à rede), reusando `handleProxyRequest`. Isso evita autochamada HTTP, não depende
da URL pública de deploy e **não altera nenhum endpoint existente**.

---

## 3. Arquivos criados / alterados

### Criado
- **`api/chatapp/verificar-triagem.mjs`** — a rota GET isolada.
  - Roteada automaticamente pela Vercel em `/api/chatapp/verificar-triagem` (filesystem routing).
  - Funções implementadas (conforme sugerido):
    - `normalizarTelefone` — remove tudo que não é dígito.
    - `gerarVariantesTelefone` — gera variações com/sem DDI 55, com/sem nono dígito, com/sem `+`.
    - `buscarItensPorTelefone` — consulta o proxy por cada variante e confirma o match.
    - `classificarRegistroPipedrive` — classifica o deal em Análise de Crédito / Pós arrematação.
    - `montarRespostaChatApp` — monta o payload fixo de resposta.

### Alterado
- **`vercel.json`** — adicionado `maxDuration: 30` para a nova função. As `rewrites`
  existentes **não** interceptam `/api/chatapp/*`, então os endpoints atuais ficam intactos.
- **`.env.example`** — documentadas as novas variáveis de ambiente.

---

## 4. Variáveis de ambiente

| Variável | Obrigatória | Uso |
|---|---|---|
| `CHATAPP_INTERNAL_TOKEN` | **Sim** | Token que o ChatApp envia. Sem ele (ou divergente) → **HTTP 401**. |
| `PIPEDRIVE_PROXY_API_TOKEN` | **Sim** (já existe) | A rota usa o **1º** token (lista separada por vírgula) para autorizar a chamada interna ao proxy. |
| `PIPELINES_ANALISE_CREDITO` | Sim* | IDs de pipeline (vírgula) que representam Análise de Crédito. |
| `STAGES_ANALISE_CREDITO` | Sim* | IDs de stage (vírgula) que representam Análise de Crédito. |
| `PIPELINES_POS_ARREMATACAO` | Sim* | IDs de pipeline (vírgula) que representam Pós arrematação. |
| `STAGES_POS_ARREMATACAO` | Sim* | IDs de stage (vírgula) que representam Pós arrematação. |

\* Pelo menos um dos dois (pipeline OU stage) por esteira precisa estar preenchido para
a classificação funcionar. `pipeline_id` **OU** `stage_id` na lista já basta para classificar.

Exemplo de preenchimento:
```bash
CHATAPP_INTERNAL_TOKEN=uma_chave_forte_aqui
PIPELINES_ANALISE_CREDITO=12,18
STAGES_ANALISE_CREDITO=87,88,89
PIPELINES_POS_ARREMATACAO=21
STAGES_POS_ARREMATACAO=120,121,122,123
```

> Como descobrir os IDs: chamar `GET /api/v2/pipelines` e `GET /api/v2/stages` no proxy
> (com `api_token`) e mapear os nomes das esteiras para seus IDs.

---

## 5. Contrato da rota

### Request
```
GET /api/chatapp/verificar-triagem?id_chat=<telefone>&token=<CHATAPP_INTERNAL_TOKEN>
```
Autenticação aceita por (qualquer um):
- query string: `?token=...`
- header: `Authorization: Bearer ...`
- header: `X-Internal-Token: ...`

### Parâmetros
| Param | Origem | Descrição |
|---|---|---|
| `id_chat` | query | Telefone do cliente (pode vir com `+`, espaços, sem o 9, etc.). |
| `token` | query/header | Token interno do ChatApp. |

### Códigos HTTP
| Situação | HTTP |
|---|---|
| Token válido (qualquer resultado de negócio) | **200** |
| Token ausente/ inválido | **401** |
| Erro de consulta ao Pipedrive/proxy | **200** (fail-safe: `triagem.necessaria = "sim"`) |

---

## 6. Estrutura fixa da resposta

```ts
{
  triagem: {
    necessaria: "sim" | "nao",
    motivo: string
  },
  cliente: {
    telefone: string,
    processo: "" | "Análise de Crédito" | "Pós arrematação",
    tipo_item: "" | "deal" | "lead",
    item_id: string,
    titulo: string
  },
  chatapp: {
    nota_funcionario: string
  },
  debug: {
    matched_phone: string,
    matches_count: number,
    error?: string
  }
}
```

### JSONPaths usados pelo ChatApp
```
$.triagem.necessaria
$.triagem.motivo
$.cliente.processo
$.cliente.tipo_item
$.cliente.item_id
$.cliente.titulo
$.chatapp.nota_funcionario
$.debug.matched_phone
$.debug.matches_count
```

### Motivos possíveis
| `triagem.necessaria` | `triagem.motivo` | Quando |
|---|---|---|
| `nao` | `cliente_em_analise_credito` | Deal aberto em pipeline/stage de Análise de Crédito. |
| `nao` | `cliente_em_pos_arrematacao` | Deal aberto em pipeline/stage de Pós arrematação. |
| `sim` | `cliente_nao_encontrado_em_esteira` | Nenhum deal aberto nessas esteiras (ou erro de consulta). |

---

## 7. Lógica interna (passo a passo)

1. **Auth:** valida `CHATAPP_INTERNAL_TOKEN`. Inválido → 401.
2. **Normaliza** `id_chat` para apenas dígitos.
3. **Gera variantes** do telefone:
   - original;
   - com `+`;
   - se brasileiro **sem** 9º dígito → gera **com** 9;
   - se brasileiro **com** 9º dígito → gera **sem** 9;
   - todas as combinações com/sem DDI `55`.
4. **Consulta o proxy** `GET /api/v2/deals/search?term=<variante>&exact_match=true&fields=custom_fields,title`
   para cada variante (dedup das variantes numéricas para reduzir chamadas).
5. **Filtra**:
   - apenas `status === "open"` (registros abertos/ativos);
   - reconfirma que o campo **Telefone do Arrematante**
     (`534ddc592e7b7db4b6d6faff0d07f2071684039e`) realmente bate com alguma variante
     (evita falso positivo da busca *fuzzy* do Pipedrive).
6. **Classifica** o primeiro deal que cair numa esteira-alvo (Análise de Crédito ou
   Pós arrematação) via os IDs configurados por env.
7. **Monta a resposta** fixa.
8. **Fail-safe:** qualquer erro → HTTP 200 com `triagem.necessaria = "sim"` e
   `debug.error` preenchido.

---

## 8. Exemplos de payload (todos os cenários)

### 8.1 Cliente em Análise de Crédito → PULAR Triagem
Request:
```
GET /api/chatapp/verificar-triagem?id_chat=553195611124&token=MINHA_CHAVE
```
Response (HTTP 200):
```json
{
  "triagem": {
    "necessaria": "nao",
    "motivo": "cliente_em_analise_credito"
  },
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
  "debug": {
    "matched_phone": "5531995611124",
    "matches_count": 1
  }
}
```
> Observação: `id_chat` veio **sem** o 9 (`553195611124`), mas o match no Pipedrive foi
> na variante **com** o 9 (`5531995611124`). É isso que aparece em `matched_phone` e
> `cliente.telefone`.

### 8.2 Cliente em Pós arrematação → PULAR Triagem
Request:
```
GET /api/chatapp/verificar-triagem?id_chat=5531987654321&token=MINHA_CHAVE
```
Response (HTTP 200):
```json
{
  "triagem": {
    "necessaria": "nao",
    "motivo": "cliente_em_pos_arrematacao"
  },
  "cliente": {
    "telefone": "5531987654321",
    "processo": "Pós arrematação",
    "tipo_item": "deal",
    "item_id": "67890",
    "titulo": "Maria Souza - Apartamento Centro"
  },
  "chatapp": {
    "nota_funcionario": "/Cliente já está em Pós arrematação no Pipedrive. Não iniciar Triagem. Assumir atendimento pela esteira atual.\n\nTelefone identificado: 5531987654321\nTipo: deal\nID Pipedrive: 67890\nTítulo: Maria Souza - Apartamento Centro"
  },
  "debug": {
    "matched_phone": "5531987654321",
    "matches_count": 1
  }
}
```

### 8.3 Cliente não está em nenhuma esteira → INICIAR Triagem
Request:
```
GET /api/chatapp/verificar-triagem?id_chat=5531991112222&token=MINHA_CHAVE
```
Response (HTTP 200):
```json
{
  "triagem": {
    "necessaria": "sim",
    "motivo": "cliente_nao_encontrado_em_esteira"
  },
  "cliente": {
    "telefone": "",
    "processo": "",
    "tipo_item": "",
    "item_id": "",
    "titulo": ""
  },
  "chatapp": {
    "nota_funcionario": ""
  },
  "debug": {
    "matched_phone": "",
    "matches_count": 0
  }
}
```
> Isso cobre tanto "telefone não existe no Pipedrive" quanto "existe, mas o deal não está
> aberto" ou "está aberto mas em outra esteira (ex.: pré-arrematação)".

### 8.4 Erro de consulta → INICIAR Triagem (fail-safe)
Acontece se o proxy/Pipedrive falhar, timeout, ou `PIPEDRIVE_PROXY_API_TOKEN` ausente.
Response (HTTP 200):
```json
{
  "triagem": {
    "necessaria": "sim",
    "motivo": "cliente_nao_encontrado_em_esteira"
  },
  "cliente": {
    "telefone": "",
    "processo": "",
    "tipo_item": "",
    "item_id": "",
    "titulo": ""
  },
  "chatapp": {
    "nota_funcionario": ""
  },
  "debug": {
    "matched_phone": "",
    "matches_count": 0,
    "error": "Falha na consulta ao proxy (status 502)."
  }
}
```

### 8.5 Token inválido → 401
Request:
```
GET /api/chatapp/verificar-triagem?id_chat=553195611124&token=ERRADO
```
Response (HTTP 401):
```json
{ "error": "unauthorized" }
```

---

## 9. Decisões e pontos em aberto (PRECISO DE ORIENTAÇÃO)

1. **Leads não são consultados.**
   O proxy atual só expõe rotas de `deals` — não há rota de `leads`. O requisito dizia
   "buscar em deal e lead, *se o proxy permitir*". Como não permite, `tipo_item` fica
   sempre `"deal"`. **Pergunta:** vale a pena estender o proxy para suportar leads, ou
   na prática os clientes em esteira sempre viram *deal*?

2. **Campo de telefone precisa ser "pesquisável" no Pipedrive.**
   A consulta usa `/deals/search`, que é uma busca *fuzzy* do Pipedrive e só encontra o
   deal se o campo **Telefone do Arrematante** estiver marcado como *searchable* no
   Pipedrive. **Pergunta:** esse campo está configurado como pesquisável? Se não, a busca
   por telefone não retorna nada. Alternativa seria varrer deals abertos e filtrar pelo
   campo (mais lento, mais chamadas).

3. **Definição de "aberto/ativo".**
   Hoje filtro `status === "open"`. Deals `won`/`lost` são ignorados. **Pergunta:** um
   cliente "Pós arrematação" pode estar com deal `won`? Se sim, preciso incluir `won`.

4. **`matches_count`.**
   Hoje conta apenas matches **dentro das esteiras-alvo** (fica 0 quando a Triagem deve
   iniciar), seguindo os exemplos originais. **Pergunta:** confirma que é isso, ou o
   ChatApp espera o total de deals que bateram o telefone?

5. **Qual deal vence quando há vários.**
   Se o telefone aparece em mais de um deal aberto, escolho o **primeiro** que classificar
   numa esteira-alvo. **Pergunta:** existe prioridade (ex.: Pós arrematação > Análise de
   Crédito, ou o mais recente)?

6. **Performance.**
   Cada variante de telefone gera uma chamada de busca; cada busca enriquece deals
   (chamadas extras ao Pipedrive). Com `maxDuration: 30s` deve ser suficiente, mas se o
   campo não for pesquisável e for preciso varrer, pode estourar. Depende da resposta do item 2.

---

## 10. Como testar

> **IMPORTANTE — limitação do servidor local:** o `server.js` (rodado por `npm run dev`)
> encaminha **todas** as requisições direto para o proxy (`handleNodeRequest`) e **não**
> conhece os arquivos de função em `api/`. Portanto `npm run dev` **NÃO** serve a rota
> `/api/chatapp/verificar-triagem` — ela cairia no roteamento do proxy. A rota só funciona:
> - em **produção/preview na Vercel** (roteamento por filesystem), ou
> - localmente via **`vercel dev`** (emula o roteamento da Vercel).

Validação de sintaxe (sempre funciona):
```bash
npm run check
node --check api/chatapp/verificar-triagem.mjs
```

Teste local com `vercel dev` (recomendado):
```bash
# .env preenchido: CHATAPP_INTERNAL_TOKEN, PIPEDRIVE_PROXY_API_TOKEN,
# PIPEDRIVE_API_TOKEN e os IDs das esteiras
vercel dev
curl "http://localhost:3000/api/chatapp/verificar-triagem?id_chat=553195611124&token=MINHA_CHAVE"
```

Teste em produção/preview após deploy:
```bash
curl "https://SEU-DOMINIO.vercel.app/api/chatapp/verificar-triagem?id_chat=553195611124&token=MINHA_CHAVE"
```

> Obs.: o `npm run dev` (server.js) sobe na porta **3001** e serve apenas o proxy
> (`/`, `/health`, `/api/v2/...`), não a rota nova.

---

## 11. O que ainda falta / próximos passos sugeridos

- [ ] Preencher os 4 IDs de esteira nas envs (produção e preview).
- [ ] Confirmar se o campo Telefone do Arrematante é pesquisável no Pipedrive (item 9.2).
- [ ] Confirmar regra de `status` aberto x ganho (item 9.3).
- [ ] Decidir sobre suporte a leads (item 9.1).
- [ ] Para testar local, usar `vercel dev` (o `npm run dev`/`server.js` NÃO serve a rota nova).
- [ ] Teste end-to-end com um telefone real conhecido em cada esteira.
```
