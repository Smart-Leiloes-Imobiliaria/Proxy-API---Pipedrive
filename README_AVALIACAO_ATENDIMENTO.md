# Avaliação automática de atendimentos ChatApp

`POST /api/chatapp/avaliar-atendimento` é uma integração secundária do
fechamento: falhar aqui **não pode** impedir o `Close Dialog` do ChatApp.
Ela não consulta nem altera Pipedrive, roteamento, rodízio, funis ou NPS.

## Fluxo

1. O Helper Close limpa o diálogo em `node-uzAAMi`.
2. Um `Transition to Scenario` chama `HELPER | GPT` (usar o ID real obtido no
   export vivo; não há ID definido neste repositório).
3. O Helper faz o POST abaixo e termina sem enviar mensagem, mudar responsável
   ou fechar o chat.
4. O Helper Close retoma em `node-ru0h71`, define `close_workflow = 0` e chega
   a `node-2nOe33` (`Close Dialog`) independentemente da resposta HTTP.

Request do Helper:

```http
POST /api/chatapp/avaliar-atendimento
Authorization: Bearer [CHATAPP_INTERNAL_TOKEN]
Content-Type: application/json
Accept: application/json

{
  "chat_id": "{{id_chat}}",
  "license_id": "{{license_id}}",
  "messenger_type": "{{messenger_type}}",
  "closed_at": "{{datetime}}",
  "source": "helper_close"
}
```

Confirme os nomes das variáveis no Bot Constructor/export atual antes de
publicar. O Scenario deve ter continuação explícita para o Helper Close mesmo
quando a API Request falhar.

## Execução local

Para testar localmente com a sua `.env`, suba o servidor Node com:

```bash
node --env-file=.env server.js
```

O servidor sobe por padrão em `http://127.0.0.1:3001`.

Teste a rota com um POST manual:

```bash
curl -i -X POST http://127.0.0.1:3001/api/chatapp/avaliar-atendimento \
  -H "Authorization: Bearer SEU_CHATAPP_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "chat_id": "CHAT_ID",
    "license_id": "LICENSE_ID",
    "messenger_type": "grWhatsApp",
    "closed_at": "2026-08-24T18:30:00.000Z",
    "source": "helper_close"
  }'
```

Se quiser simular exatamente o fluxo do Bot, basta disparar esse POST no
momento em que o Helper Close terminaria o atendimento. O campo `closed_at`
continua obrigatório para a execução normal; porém você pode enviar também
`session_started_at` (ou `started_at`) junto com `closed_at` para reduzir o
intervalo do transcript e melhorar a precisão da avaliação.

Exemplo de chamada com `closed_at` e `session_started_at`:

```bash
curl -i -X POST http://127.0.0.1:3001/api/chatapp/avaliar-atendimento \
  -H "Authorization: Bearer SEU_CHATAPP_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "chat_id": "CHAT_ID",
    "license_id": "LICENSE_ID",
    "messenger_type": "grWhatsApp",
    "session_started_at": "2026-08-24T17:30:00.000Z",
    "closed_at": "2026-08-24T18:30:00.000Z",
    "source": "helper_close"
  }'
```

## Configuração

Defina no ambiente Vercel, sem versionar segredos:

- `CHATAPP_INTERNAL_TOKEN` (já usado pelas rotas ChatApp);
- `CHATAPP_API_BASE_URL`, `CHATAPP_COMPANY_ID`;
- `CHATAPP_EMAIL`, `CHATAPP_PASSWORD`, `CHATAPP_APP_ID`;
- `CHATAPP_ACCESS_TOKEN`, `CHATAPP_ACCESS_TOKEN_END_TIME`;
- `CHATAPP_REFRESH_TOKEN`, `CHATAPP_REFRESH_TOKEN_END_TIME`;
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `EVALUATION_PROMPT_FILE`;
- `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_SHEET_NAME`;
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.

`EVALUATION_PROMPT_FILE` aponta para um arquivo versionado no projeto e é o
modo preferencial para local e Vercel. `EVALUATION_PROMPT` permanece apenas
como fallback legado. A conta de serviço deve ter acesso de **Editor** à
planilha e o escopo Google Sheets API precisa estar habilitado no projeto dela.
Crie a aba configurada já com os cabeçalhos, nesta ordem: `ChatID`, `Nome do
Responsável`, `Horário`, `Nome do Cliente`, `Nota`, `Justificativa` (A:F).

## Contratos e proteção de dados

Sucesso:

```json
{"success":true,"status":"saved","chat_id":"CHAT_ID","responsible_name":"Nome","client_name":"Cliente","nota":4}
```

Um retry do mesmo `ChatID` e horário devolve `already_processed`; o mesmo chat
em outro fechamento cria uma nova linha. A verificação é feita na própria
planilha antes e imediatamente antes do append. Sem um armazenamento com lock
distribuído, duas invocações exatamente simultâneas ainda são uma limitação
inerente ao MVP baseado apenas em Sheets.

O proxy obtém chat, responsável e mensagens diretamente da API ChatApp. Ele
limita o histórico a `closed_at`, segue a paginação de até 100 mensagens por
página e aceita futuramente `session_started_at` quando houver webhook
`chatStatus`. Por padrão, `closed_at` e `session_started_at` recebem offset de
`+3h` antes do filtro e da chave salva na planilha, porque o datetime emitido
pelo ChatApp neste fluxo chega deslocado. Ajuste
`CHATAPP_EVALUATION_TIME_OFFSET_HOURS=0` se o Scenario passar ISO UTC correto.

A OpenAI não recebe o payload cru de `/messages`. O backend transforma a lista
em um transcript normalizado com horários, `CLIENTE`, `ASSESSOR` e
`OUTRO PARTICIPANTE`. Mensagens de sistema/automação, comandos `/`, Router,
Pipedrive, LOOP, NPS e mensagens sem autoria humana verificável não entram na
nota. Telefones, e-mails e CPFs evidentes são removidos do transcript enviado à
OpenAI; binários viram um marcador simples. Se mais de um funcionário humano
responder na conversa, o endpoint avalia até os dois participantes com mais
mensagens, mantendo o responsável atual como prioridade quando ele participou.
A chamada Responses usa `store: false` e JSON Schema estrito para `avaliavel` e
`nota` inteira de 1 a 5.

Erros retornam JSON estruturado e logs sem tokens nem transcript. `not_evaluable`
é um resultado bem-sucedido que não grava linha; os motivos possíveis incluem
ausência de responsável ou de mensagem humana atribuível ao responsável atual.

## Validação

Execute `npm run check`. A suíte não usa ChatApp, OpenAI nem Google reais e
cobre transcript, erros, idempotência, mensagens automáticas, autoria múltipla
e payload/autenticação.
