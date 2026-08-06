# Rota nova `/api/chatapp/rotear-funil` — roteamento persistente por funil

Rota **nova**, criada para não alterar o comportamento de nenhuma rota já em
produção (`/api/chatapp/verificar-triagem`,
`/api/chatapp/verificar-triagem-direcionamento`,
`/api/chatapp/verificar-triagem-funis`). Segue o mesmo padrão já usado neste
projeto para introduzir rotas experimentais sem mexer no que já funciona
(igual ao que foi feito para `/verificar-triagem-funis`).

## Quando o ChatApp chama esta rota

A triagem inicial do chatbot **nunca** chama esta rota: ela sempre move o
diálogo para o funil `Atendimento` e executa o rodízio. A consulta só
acontece quando:

- um assessor move manualmente o diálogo para um funil de processo
  (`Triagem de Documentos`, `Análise de Crédito` ou `Financiamento`); ou
- um chat já nesse funil é reaberto ou precisa ser revalidado.

O fechamento do chat preserva o funil e o responsável atual; a reabertura
deve chamar esta rota novamente para corrigir qualquer alteração manual ou
mudança feita direto no Pipedrive nesse meio tempo. Esse comportamento de
"preservar ao fechar / revalidar ao reabrir" é responsabilidade do **bot**;
o proxy é somente leitura e não guarda estado entre chamadas.

## Requisição

```
GET /api/chatapp/rotear-funil?id_chat=<telefone>&tipo=<tipo>&token=<CHATAPP_INTERNAL_TOKEN>
```

- `id_chat`: telefone do diálogo (aceita formatação livre — `+55`, espaços,
  hífen, parênteses; tudo é normalizado para dígitos antes de comparar).
- `tipo`: um de `triagem_documentos`, `analise_credito`, `financiamento`.
- Autenticação: reusa `CHATAPP_INTERNAL_TOKEN` (já usado pelas rotas
  irmãs), via `?token=`, header `Authorization: Bearer` ou
  `X-Internal-Token`.

`id_chat` ausente/vazio → `400 {"error":"missing_id_chat"}`.
`tipo` ausente ou fora do conjunto suportado → `400 {"error":"invalid_tipo"}`.
Token ausente/inválido → `401 {"error":"unauthorized"}`.

## Contrato de resposta (sempre plano — nunca array de negócios)

```json
{
  "success": true,
  "routing_key": "ANALISE_CREDITO_DANIELA",
  "responsible_option_id": 2805,
  "responsible_name": "Daniela Silva",
  "deal_id": 12345,
  "deal_title": "...",
  "matches_count": 1,
  "selection_reason": "single_open_deal",
  "note": ""
}
```

`routing_key` é convertido pelo **bot** em `responsibleId` do ChatApp — este
proxy nunca resolve o ID de funcionário do ChatApp, apenas identifica o
negócio elegível e o valor bruto do campo de atribuição do Pipedrive.

Quando não há um negócio elegível, `success` é `false` e a resposta continua
em **HTTP 200** (nunca 4xx/5xx para resultado de negócio):

```json
{
  "success": false,
  "routing_key": "SEM_ROTA_CARD_NAO_ENCONTRADO",
  "responsible_option_id": null,
  "responsible_name": null,
  "deal_id": null,
  "deal_title": null,
  "matches_count": 0,
  "selection_reason": "no_eligible_deal",
  "note": "/Não foi possível identificar um negócio elegível no Pipedrive. O chat será direcionado para Atendimento."
}
```

Regra simples para o bot: **`success` é sempre `false` quando `routing_key`
começa com `SEM_ROTA`**, e `true` em qualquer outro caso (inclusive nas
chaves compostas de Triagem de Documentos e nas que ainda não têm
`employeeId` confirmado — nesses casos o próprio bot decide fazer fallback
para Atendimento).

Quando um negócio É selecionado mas o campo de responsável está vazio,
desconhecido ou marcado `n/a`, `deal_id`/`deal_title` continuam preenchidos
(o negócio foi encontrado; só o responsável não pôde ser resolvido).

## IDs fixos usados pela rota

Constantes nomeadas em `lib/chatapp-rotear-funil.js` (não dependem de env —
os IDs já foram confirmados e não devem ser resolvidos por nome):

| Constante | Valor |
|---|---|
| `PIPELINE_ANALISE_CREDITO_ID` | `16` |
| `PIPELINE_POS_ARREMATACAO_ID` | `6` |
| `PAYMENT_OPTION_FINANCED` | `34` (Financiado / FGTS Financiado) |

Campos lidos (hashes já confirmados e reaproveitados de
`lib/pipedrive-live-proxy.js`, sem inventar nada novo):

| Campo | Hash |
|---|---|
| Telefone do Arrematante | `534ddc592e7b7db4b6d6faff0d07f2071684039e` |
| Forma de Pagamento | `ead65a1f666494607bbbf807aaff5b1123b893df` |
| Atribuído: Análise de Crédito | `69fa3118e5a8ae5032e8f50b9f9f4fb99fc305b9` |
| Atribuído: Financiamento | `8b0781e1587ea24eb1a127c00648e2926412da25` |
| Atribuído: Triagem de Documentos | `92c12e9a1b7987c5961b996eac85f462c4546f1a` |

## Telefone: igualdade exata

`id_chat` e o campo `Telefone do Arrematante` são normalizados para dígitos.
Variações do 9º dígito e do DDI `55` são geradas (mesmo mecanismo de
`lib/chatapp-triagem.js`) só para efeito de **busca** no Pipedrive. A
confirmação final exige **igualdade exata** entre o telefone normalizado do
deal e alguma das variantes geradas do telefone do chat — nunca `contains`,
prefixo ou sufixo parcial, para não misturar clientes com números
parecidos. Telefones são sempre mascarados nos logs (só os 4 últimos
dígitos aparecem).

## Regras por `tipo`

### `analise_credito`

Filtra `pipeline_id = 16`, `status = open`, telefone igual. `won`, `lost` e
demais status são ignorados.

- 0 negócios → `SEM_ROTA_CARD_NAO_ENCONTRADO`
- 1 negócio → seleciona (`selection_reason = single_open_deal`)
- >1 negócios abertos → não escolhe, `SEM_ROTA_MULTIPLOS_ANALISE_OPEN`,
  `matches_count` com a contagem real

Lê `Atribuído: Análise de Crédito`:

| Option ID | Routing key | Nome |
|---|---|---|
| `2659` | `ANALISE_CREDITO_THALES` | Thales Gabriel |
| `2805` | `ANALISE_CREDITO_DANIELA` | Daniela Silva |

Campo vazio, `n/a` ou option ID desconhecido →
`SEM_ROTA_RESPONSAVEL_ANALISE_INVALIDO`. **Yara não é inferida por
nome/owner**: nenhum option ID mapeia para ela hoje porque o XLS fornecido
não confirma o ID dela nesse campo. O bot já aceita `ANALISE_CREDITO_YARA`
para quando esse ID for informado — basta somar a entrada em
`ROTAS_ANALISE_CREDITO`.

### `financiamento`

Filtra `pipeline_id = 6`, `status = open`, telefone igual, Forma de
Pagamento `= 34`.

- 0 negócios → `SEM_ROTA_CARD_NAO_ENCONTRADO`
- 1 negócio → seleciona
- >1 negócios → ordena por `deal.id` numérico crescente, seleciona o menor;
  `matches_count` é a quantidade elegível **antes** da seleção;
  `selection_reason = lowest_deal_id_among_financed_open_deals`

Lê `Atribuído: Financiamento`:

| Option ID | Routing key | Nome |
|---|---|---|
| `2699` | `FINANCIAMENTO_JESSICA_FRANCKLIN` | Jessica Francklin |
| `2700` | `FINANCIAMENTO_ANA_SOUZA` | Ana Souza |
| `2707` | `FINANCIAMENTO_DANIELA` | Daniela Silva |
| `2709` | `FINANCIAMENTO_ISADORA` | Isadora Campos |
| `2793` | `FINANCIAMENTO_DIMITRI` | Dimitri Garcia |
| `2804` | `FINANCIAMENTO_MARLOON` | Marloon Santos |
| `2810` | `SEM_ROTA_RESPONSAVEL_NA` | n/a |
| `2833` | `FINANCIAMENTO_JOAO_MARINHO` | João Marinho |

Option ID desconhecido (ou campo vazio) → `SEM_ROTA_RESPONSAVEL_FINANCIAMENTO_INVALIDO`.

João Marinho corresponde ao employee ChatApp João Victor (`99587`,
`joaomarinho.smart@gmail.com`); Marloon Santos corresponde a Marloon
Francisco (`98226`, `marloonsantos.smart@gmail.com`) — mapeamento fica no
**bot**, o proxy só emite `responsible_name` como veio do Pipedrive.
Jessica Francklin e Ana Souza ainda não têm `employeeId` confirmado no
ChatApp: o proxy emite a routing key normalmente (`success: true`); o bot
é quem faz fallback para Atendimento até os IDs serem fornecidos.

### `triagem_documentos`

Só é chamado depois que um assessor move manualmente o chat para
`Triagem de Documentos`.

1. Busca negócios `open` do telefone no pipeline `16`.
2. Busca negócios `open` do telefone no pipeline `6`, exigindo Forma de
   Pagamento `34`.
3. Se só um dos dois pipelines tem candidatos, aplica a regra de seleção
   **daquele** pipeline (a mesma de `analise_credito` ou `financiamento`
   acima, incluindo o fallback de ambiguidade `SEM_ROTA_MULTIPLOS_ANALISE_OPEN`
   quando aplicável ao pipeline 16).
4. Se **ambos** têm candidato elegível → `SEM_ROTA_TRIAGEM_PIPELINE_AMBIGUO`,
   `matches_count` = soma dos elegíveis dos dois pipelines.
5. Sem candidato em nenhum dos dois → `SEM_ROTA_CARD_NAO_ENCONTRADO`.

Depois de selecionar o negócio, lê `Atribuído: Triagem de Documentos`
(campo de opções múltiplas). Se **mais de um** option ID estiver
selecionado nesse campo → `SEM_ROTA_TRIAGEM_MULTIPLOS_VALORES` (isso é
diferente de uma opção composta, que é um único option ID cujo *label* tem
duas pessoas).

| Option ID | Routing key | Nome |
|---|---|---|
| `2672` | `TRIAGEM_DOCUMENTOS_DANIELA_YASMIN` | Daniela Silva \| Yasmin Rodrigues |
| `2806` | `TRIAGEM_DOCUMENTOS_YASMIN_GUILHERME` | Yasmin Rodrigues \| Guilherme Oliveira |
| `2876` | `TRIAGEM_DOCUMENTOS_YASMIN` | Yasmin Rodrigues |
| `2877` | `TRIAGEM_DOCUMENTOS_ISAQUE` | Isaque Coelho |

A opção `2760` (`Daniela Silva | Isadora Campos`) está **descontinuada** e
retorna `SEM_ROTA_OPCAO_DESCONTINUADA_DANIELA_ISADORA` em vez de uma rota
funcional.

Como o ChatApp aceita um único responsável, as chaves compostas (`2672` e
`2806`) são preservadas como estão — o proxy **não** escolhe silenciosamente
uma pessoa da dupla. `success` continua `true` nesses casos (a identificação
no Pipedrive foi bem-sucedida); é o bot quem decide fazer fallback até a
regra de responsável primário ser definida.

Option ID desconhecido ou campo vazio →
`SEM_ROTA_RESPONSAVEL_TRIAGEM_INVALIDO` *(ver "Divergências" abaixo — essa
chave não está explicitada na especificação original, foi adicionada por
simetria com as outras duas regras de tipo)*.

## Compatibilidade com chaves legadas

As chaves antigas (`DOCUMENTACAO_PENDENTE_ISAQUE`, `DOCUMENTACAO_PENDENTE_ISADORA`,
`ANALISE_CREDITO_DANIELA`, `ANALISE_CREDITO_THALES`, `FINANCIAMENTO_MARLOON`)
continuam aceitas pelo bot durante a transição. Esta rota nova só emite as
chaves ativas listadas acima; `DOCUMENTACAO_PENDENTE_*` não existe mais
como conceito aqui (não há mais um `tipo` correspondente).

## Erros técnicos vs. erros de negócio

- **Erro técnico** (timeout, upstream do Pipedrive fora do ar, etc.):
  `lib/chatapp-rotear-funil.js` **não captura** esses erros — eles propagam
  para `dispatchProxyRequest_`/`handleProxyRequest` em
  `lib/pipedrive-live-proxy.js`, que já converte qualquer `ProxyHttpError`
  em `5xx`/`502`/`504`, exatamente como todas as outras rotas do proxy.
  Timeout upstream já é `PIPEDRIVE_PROXY_FETCH_TIMEOUT_MS` (padrão 25s,
  configurável), abaixo do limite de 60s pedido.
- **Erro de negócio** (nenhum negócio elegível, ambiguidade, responsável
  inválido): sempre `HTTP 200` com o payload plano do contrato acima.
- Nunca expõe token nem telefone completo — nem na resposta, nem no log
  estruturado (`console.log` com telefone mascarado, sem token).

Essa separação é uma diferença deliberada em relação às rotas irmãs
(`chatapp-triagem.js`, `chatapp-direcionamento.js`, `chatapp-funis.js`), que
capturam **qualquer** erro (técnico ou não) e sempre devolvem 200
fail-safe. Aqui a tarefa pediu explicitamente 5xx para falha técnica, então
esta rota nova segue esse contrato — sem alterar o comportamento das rotas
antigas.

## Evento imediato de mudança de funil (`chatFunnelStage`)

O repositório **não** possui hoje nenhum receptor de eventos/webhook do
ChatApp (não há rota `/api/events` nem handler equivalente). Como a própria
tarefa condiciona a implementação do handler de `chatFunnelStage` a "se o
repositório já recebe eventos ChatApp", e explicitamente permite degradar
("sem listener, o bot ainda detecta a troca na próxima mensagem ou
checkpoint do Loop"), **não foi criada nenhuma infraestrutura de webhook
nova** nesta entrega — isso exigiria inventar um mecanismo de recepção de
eventos que não existe hoje no projeto. Se/quando esse listener for
adicionado, o gatilho deve chamar `/api/chatapp/rotear-funil` (ou acionar
`/rotearfunil` como mensagem interna) para revalidar o diálogo, com
deduplicação por chat + stage + timestamp e cuidado para não recursar
quando a própria automação move o funil de volta para Atendimento em
fallback.

## Testes

`test/chatapp-rotear-funil.test.js` cobre os 20 cenários obrigatórios da
tarefa: seleção single/multi/zero por tipo, todas as routing keys ativas
(incluindo `2833`/João Marinho e `2810`/n/a), opção descontinuada `2760`,
chaves compostas de Triagem de Documentos, ambiguidade entre pipelines,
normalização de telefone com `+55`/espaços/hífen/parênteses, igualdade
exata (prova negativa contra falso positivo por sufixo), payload sempre
plano (nunca array), e ausência de telefone completo/token em log e
resposta. Roda com `npm run check` (que também roda as suítes das rotas
irmãs, já passando sem alteração).

## Divergências / decisões não explicitadas na tarefa

1. **`SEM_ROTA_RESPONSAVEL_TRIAGEM_INVALIDO`**: a tarefa define chaves de
   fallback "campo inválido" para `analise_credito` e `financiamento`, mas
   não para `triagem_documentos`. Adicionei essa chave por simetria — sem
   ela, um option ID desconhecido nesse campo não teria para onde ir.
2. **`selection_reason` para os casos de fallback**: a tarefa só define o
   valor `single_open_deal` (sucesso) e
   `lowest_deal_id_among_financed_open_deals` (financiamento com múltiplos).
   Para "nenhum elegível" usei `no_eligible_deal`; para "múltiplos em
   Análise de Crédito" usei `multiple_open_deals`; para ambiguidade entre
   pipelines na Triagem de Documentos usei `ambiguous_pipeline`.
3. **`matches_count` na ambiguidade entre pipelines** (`triagem_documentos`):
   a tarefa não define o valor exato; usei a soma dos elegíveis dos dois
   pipelines (não há como detalhar por pipeline num payload plano).
4. **`deal_id`/`deal_title` quando o negócio foi selecionado mas o
   responsável é inválido/`n/a`/descontinuado**: mantive preenchidos (o
   negócio existe; só o responsável não pôde ser resolvido), diferente do
   caso "nenhum negócio elegível" (tudo `null`).
5. **`id_chat` ausente/`tipo` inválido**: não estavam no contrato de erro da
   tarefa; segui o padrão já usado em `chatapp-funis.js`
   (`400 {"error":"missing_id_chat"}`) e apliquei o mesmo formato para
   `tipo` inválido (`400 {"error":"invalid_tipo"}`).
6. **Handler de `chatFunnelStage`**: não implementado — ver seção acima.
