# Avaliação de atendimentos Bitrix24 — sessão manual e `OnSessionFinish`

`POST /api/bitrix/avaliar-atendimento` avalia uma sessão encerrada do Contact
Center/Open Lines. O contrato de avaliação (prompt, Responses API, JSON Schema
estrito, nota de 1 a 5 e justificativa) é o mesmo usado no ChatApp; a coleta é
específica do Bitrix24 e usa a sessão retornada por
`imopenlines.session.history.get`, não uma janela de datas.

O fluxo manual permanece disponível para diagnóstico. A segunda fase acrescenta
uma aplicação local OAuth, recepção rápida do evento `OnSessionFinish`, fila
durável no Supabase e processamento em background com `waitUntil`. A unidade do
job é sempre a `session_id` recebida do Bitrix; o worker não reconstrói a sessão
por janela de datas nem faz HTTP do proxy para ele mesmo. Um cron diário,
compatível com o plano Hobby, recupera jobs que tenham permanecido pendentes ou
falhado; novos eventos também acionam imediatamente a fila.

```text
Bitrix24 OnSessionFinish
  -> POST /api/bitrix/events
  -> valida member_id + application_token + allowlists
  -> persiste job único por portal/sessão no Supabase
  -> agenda o worker em background e responde 202
  -> GET /api/bitrix/processar-fila (recuperação diária/manual)
  -> histórico por SESSION_ID -> normalização -> OpenAI -> Sheets
```

O recebimento real ainda depende da regra do Bitrix24: a aplicação só recebe
`OnSessionFinish` destinado ao conector adicionado por ela. O conector do chat
controlado é o `livechat` nativo; por isso, a implementação e o binding não
devem ser declarados homologados até um encerramento real chegar ao handler.

## Restrição obrigatória do teste

Os chats autorizados nesta retomada são `64395` e `67331`. Ambos foram
confirmados por leitura na API do Bitrix24; o primeiro resolveu a sessão
`246017` e o segundo a sessão `252347` na verificação de 24/09/2026. Configure
`BITRIX_ALLOWED_CHAT_IDS=64395,67331`; não inclua a linha inteira nem outros
chats. Para um teste ainda mais restrito, configure também apenas o
`SESSION_ID` recém-criado em `BITRIX_ALLOWED_SESSION_IDS`.

A rota falha de forma fechada se nenhuma destas allowlists estiver configurada:

- `BITRIX_ALLOWED_SESSION_IDS` — opção preferida no primeiro teste;
- `BITRIX_ALLOWED_CHAT_IDS` — permite novas sessões somente no chat confirmado;
- `BITRIX_ALLOWED_LINE_IDS` — usar apenas depois de confirmar que a linha contém
  exclusivamente o canal autorizado.

Uma sessão é aceita se corresponder a pelo menos uma allowlist. O `CHAT_ID` e o
`LINE_ID` são confrontados com o histórico devolvido pelo próprio Bitrix24; não
se confia apenas no body da requisição.

## Endpoint e body

```http
POST /api/bitrix/avaliar-atendimento
Authorization: Bearer SEU_BITRIX_INTERNAL_TOKEN
Content-Type: application/json
```

```json
{
  "chat_id": 64395,
  "source": "bitrix24",
  "dry_run": true
}
```

Envie `session_id` ou `chat_id`. `member_id` pode ser omitido no MVP single
tenant, pois vem de `BITRIX_MEMBER_ID`; eventos OAuth futuros podem enviá-lo
explicitamente. Quando somente `chat_id` é enviado, o próprio
endpoint consulta o histórico pela API e resolve a sessão mais recente. Em um
evento automático futuro, prefira o `session_id` recebido em `OnSessionFinish`,
pois ele identifica de forma imutável a sessão encerrada. Se ambos forem
enviados, os dois são confrontados com o histórico.
`source` aceita `bitrix24`, `manual` ou `on_session_finish`; a origem persistida é
sempre `Bitrix24`. `force=true` só funciona quando `BITRIX_ALLOW_FORCE=true`.

Use `dry_run=true` primeiro. Ele consulta e normaliza o histórico, devolve apenas
o transcript sanitizado e os candidatos encontrados, sem chamar OpenAI e sem
gravar no Google Sheets.

Resultados normais: `dry_run`, `saved`, `already_processed` e `not_evaluable`.
Falhas retornam códigos estruturados sem tokens, URLs privadas ou payload bruto.

## Endpoints

- `POST /api/bitrix/install` — callback inicial da aplicação local; aceita JSON
  e formulário com colchetes, verifica o token no portal, criptografa e persiste
  a instalação e reconcilia o binding `ONSESSIONFINISH`.
- `POST /api/bitrix/events` — valida o `application_token`, percorre todos os
  itens de `data.DATA`, restringe ao chat autorizado e persiste antes do ACK.
  O identificador aceita os formatos `eventId`, `event_id` e
  `event_handler_id`, cobrindo os contratos específico e geral do Bitrix24.
- `GET|POST /api/bitrix/processar-fila` — worker autenticado por `CRON_SECRET`;
  processa jobs pendentes, recupera jobs travados e aplica retry com backoff. O
  evento chama o mesmo domínio via `waitUntil`; o cron diário funciona como
  reconciliação compatível com as limitações do plano Vercel atual.
- `POST /api/bitrix/avaliar-atendimento` — diagnóstico/reprocessamento manual.

Tokens do bloco `auth` nunca são gravados no job. Na tabela de instalações,
`access_token`, `refresh_token` e `application_token` são cifrados com
AES-256-GCM e autenticação contextual antes da escrita.

## Configuração

Variáveis próprias:

```dotenv
BITRIX_WEBHOOK_BASE_URL=https://PORTAL.bitrix24.com.br/rest/USUARIO/SEGREDO/
BITRIX_MEMBER_ID=member_id_recebido_no_callback
BITRIX_INTERNAL_TOKEN=token_interno_exclusivo
BITRIX_PORTAL_DOMAIN=smartcaixa.bitrix24.com.br
BITRIX_ALLOWED_SESSION_IDS=
BITRIX_ALLOWED_CHAT_IDS=64395,67331
BITRIX_ALLOWED_LINE_IDS=
BITRIX_IGNORED_USER_IDS=
BITRIX_ALLOW_FORCE=false
BITRIX_FETCH_TIMEOUT_MS=10000
BITRIX_FETCH_RETRIES=2
BITRIX_EVAL_MAX_TRANSCRIPT_CHARS=12000
BITRIX_EVALUATION_PROMPT_FILE=prompts/chatapp-evaluation.txt
BITRIX_DEBUG=false
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_CONFIGURE_NO_AMBIENTE
BITRIX_TOKEN_ENCRYPTION_KEY=CONFIGURE_32_BYTES_EM_BASE64
BITRIX_SINGLE_TENANT=true
BITRIX_EXPECTED_MEMBER_ID=member_id_recebido_no_callback
BITRIX_CLIENT_ID=
BITRIX_CLIENT_SECRET=
BITRIX_OAUTH_REFRESH_SKEW_MS=60000
BITRIX_EVENT_HANDLER_URL=https://api-zendesk-vercel-proxy.vercel.app/api/bitrix/events
BITRIX_ALLOWED_CONNECTORS=livechat
CRON_SECRET=CONFIGURE_TOKEN_FORTE
BITRIX_QUEUE_BATCH_SIZE=1
BITRIX_QUEUE_MAX_ATTEMPTS=5
SUPABASE_FETCH_TIMEOUT_MS=10000
```

Depois da instalação OAuth, `BITRIX_MEMBER_ID` e, no modo single tenant,
`BITRIX_EXPECTED_MEMBER_ID` devem receber o `member_id` real enviado pelo
callback. Esse identificador pertence à instalação do portal e não é o ID `9`
da conta que criou o webhook. O webhook de entrada permanece apenas como
fallback para uma instalação ainda não encontrada no repositório. Ao recriar a
aplicação, compare novamente os dois valores locais com o callback; na retomada
de 24/09/2026, o arquivo local ainda continha identificadores provisórios.

O cliente OAuth renova o token preventivamente antes do vencimento, usando por
padrão a margem de 60 segundos configurável em
`BITRIX_OAUTH_REFRESH_SKEW_MS`. A resposta do Bitrix substitui de forma atômica
os tokens cifrados e o novo vencimento no Supabase; a reação a
`expired_token` permanece como contingência.

O webhook completo é uma credencial. Guarde-o apenas no ambiente local/Vercel e
considere rotacioná-lo após compartilhamento em canais de trabalho. O token
interno deve ser diferente de `CHATAPP_INTERNAL_TOKEN`.

Use `BITRIX_IGNORED_USER_IDS` somente para contas que sejam exclusivamente bots
ou serviços. O usuário proprietário do webhook não deve ser ignorado apenas por
ser proprietário; templates automáticos conhecidos já são excluídos pelo tipo e
conteúdo da mensagem, preservando respostas humanas da mesma conta.

A integração reutiliza `OPENAI_API_KEY`, `OPENAI_MODEL`,
`GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_SHEET_NAME`, a conta de serviço
Google e o mesmo prompt por padrão. Um prompt específico pode ser selecionado em
`BITRIX_EVALUATION_PROMPT_FILE`.

Bitrix24 e ChatApp gravam na mesma aba A:I:

```text
ChatID | Link do Chat | Nome do Responsável | Horário |
Nome do Cliente | Nota | Justificativa | Textos Captados | Origem
```

A coluna `ChatID` recebe somente o número real do chat. `Link do Chat` recebe a
URL direta do diálogo Bitrix24; no ChatApp, o link é construído com licença,
messenger type e chat ID. A escrita continua sendo append e a idempotência do
Bitrix usa chat, horário de encerramento, responsável e origem. Como o MVP usa
leitura + append no Sheets sem lock distribuído, duas invocações manuais
exatamente simultâneas ainda podem duplicar uma linha. No caminho automático, a
fila Supabase aceita somente um job por portal/sessão antes de chamar essa
persistência.

## Teste local controlado

```bash
node --env-file=.env --env-file=.env.avaliar server.js
```

O primeiro arquivo fornece as variáveis obrigatórias do proxy Pipedrive; o
segundo acrescenta/sobrescreve as variáveis de avaliação e Bitrix24. Se todas
as variáveis forem consolidadas em um único `.env`, use somente esse arquivo.

```bash
curl -i -X POST http://127.0.0.1:3001/api/bitrix/avaliar-atendimento \
  -H "Authorization: Bearer SEU_BITRIX_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "chat_id": 64395,
    "source": "bitrix24",
    "dry_run": true
  }'
```

O retorno informa o `session_id` resolvido. Após conferir `session_id`,
`chat_id`, `line_id`, participantes e transcript,
repita sem `dry_run` para executar OpenAI e Sheets. Nunca use uma sessão de outro
chat para diagnóstico.

## Segurança e tratamento do histórico

- Somente POST autenticado por Bearer próprio.
- Body limitado a 64 KiB pelo servidor local/proxy.
- Consulta por `SESSION_ID` quando fornecido; fallback manual por `CHAT_ID`
  resolve a última sessão dentro do próprio endpoint.
- Cliente externo identificado principalmente por
  `users[senderid].connector === true`; no livechat observado, mensagens humanas
  recebidas podem vir como `senderid=0` sem usuário externo em `users`, e são
  aceitas somente após excluir componentes, formulários e anexos de sistema.
- Owner, managers e autores internos humanos formam até dois candidatos.
- Mensagens de sistema/bot, eventos de entrada/saída, formulários automáticos,
  templates de pesquisa e usuários em `BITRIX_IGNORED_USER_IDS` são excluídos.
- BBCode técnico do Bitrix24 é convertido em texto limpo.
- CPF, telefone e e-mail evidentes são removidos antes da OpenAI e da planilha.
- A regex de telefone usa limites numéricos para não substituir trechos de
  códigos longos, números de imóvel ou outros identificadores concatenados.
- Anexos viram marcadores; nenhum arquivo é baixado.
- O payload bruto e as URLs privadas de arquivo não são enviados ao modelo.
- A falha da avaliação não altera nem reabre a sessão do Bitrix24.

## Relação com a automação `webhook-jhonatan`

A automação `smartcaixa-bitrix-webhook-jhonatan` já observa mensagens pelo bot
supervisor `18803` e sincroniza sessões da linha `19` com as APIs oficiais
`imopenlines.v2.*` a cada cinco minutos. Ela não deve ser substituída, receber
outro bot concorrente ou ter sua rota produtiva alterada apenas para este teste.

O banco configurado neste proxy não expõe a tabela `bitrix_chat_sessions` usada
por aquela automação; portanto, o proxy não consegue usar diretamente a
sincronização analítica como gatilho. Nesta homologação, `OnSessionFinish`
continua como caminho de baixa latência. Se o binding ficar confirmado, mas
nenhum job chegar após o encerramento real nos dois chats, o evento não deve ser
tratado como confiável para o conector nativo. O fallback recomendado é uma
ponte explícita no módulo Chat Analytics: ao reconciliar uma sessão fechada,
chamar o endpoint autenticado deste proxy com a `session_id`, preservando a
idempotência existente.

## Recriação da aplicação e `OnSessionFinish`

A documentação oficial limita `OnSessionFinish` aos eventos destinados ao
conector adicionado pela própria aplicação. Para instalar e homologar:

1. executar `supabase/migrations/20260903_bitrix_on_session_finish.sql` no SQL
   Editor do projeto Supabase;
2. publicar o proxy com as variáveis de produção configuradas;
3. como administrador, criar uma aplicação local **somente API**, com permissão
   `imopenlines` e caminho inicial
   `https://api-zendesk-vercel-proxy.vercel.app/api/bitrix/install`;
4. salvar `BITRIX_CLIENT_ID` e `BITRIX_CLIENT_SECRET` somente no ambiente do
   servidor; o callback captura os demais tokens automaticamente;
5. confirmar no Supabase que a instalação ficou `bound`; esse estado só é salvo
   depois que `event.bind` responde e `event.get` contém `ONSESSIONFINISH`;
6. iniciar e encerrar sessões reais exclusivamente nos chats `64395` e `67331`,
   uma por vez;
7. confirmar o job e a linha de avaliação, sem registrar tokens ou transcript
   bruto nos logs.

Se o conector não entregar o evento à aplicação, o binding pode existir sem
nenhum job ser criado. Nesse cenário, o sistema que conhece o encerramento deve
chamar o endpoint manual ou deve ser criado um polling confiável; um webhook de
saída genérico não substitui essa garantia.

O roteiro operacional completo está em
[`GUIA_TESTES_BITRIX_AVALIACAO.md`](./GUIA_TESTES_BITRIX_AVALIACAO.md).

Referências oficiais: [OnSessionFinish](https://apidocs.bitrix24.com/api-reference/imopenlines/openlines/events/on-session-finish.html),
[histórico por sessão](https://apidocs.bitrix24.com/api-reference/imopenlines/openlines/sessions/imopenlines-session-history-get.html) e
[event.bind](https://apidocs.bitrix24.com/api-reference/events/event-bind.html).

## Validação local

```bash
npm run check
```

A suíte cobre cliente REST, refresh OAuth preventivo e reativo simulados,
transcript, PII, anexos,
allowlist, `dry_run`, idempotência, endpoint e toda a regressão do ChatApp. Não
há chamadas reais a Bitrix24, OpenAI ou Google durante os testes.
