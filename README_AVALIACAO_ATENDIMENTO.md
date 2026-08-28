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
  "started_at": "{{started_at}}",
  "closed_at": "{{datetime}}",
  "source": "chatapp"
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
    "source": "chatapp"
  }'
```

Se quiser simular exatamente o fluxo do Bot, basta disparar esse POST no
momento em que o Helper Close terminaria o atendimento. O campo `closed_at`
continua obrigatório para a execução normal; porém você pode enviar também
`session_started_at` (ou `started_at`) junto com `closed_at` para reduzir o
intervalo do transcript e melhorar a precisão da avaliação.

`closed_at`, `session_started_at` e `started_at` aceitam ISO ou o formato
nativo do ChatApp `DD.MM.YYYY HH:MM:SS`. O formato nativo é interpretado como
horário local enviado pelo ChatApp e depois passa pelo offset configurado em
`CHATAPP_EVALUATION_TIME_OFFSET_HOURS`, mantendo compatibilidade com os fluxos
que ainda enviam ISO.

`source` é obrigatório e aceita apenas `chatapp` ou `bitrix24`; na planilha,
esses valores são gravados como `ChatApp` e `Bitrix24`.

Exemplo de chamada com o formato nativo do ChatApp:

```bash
curl -i -X POST http://127.0.0.1:3001/api/chatapp/avaliar-atendimento \
  -H "Authorization: Bearer SEU_CHATAPP_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "chat_id": "553195611124",
    "license_id": "76040",
    "messenger_type": "caWhatsApp",
    "started_at": "27.08.2026 09:20:15",
    "closed_at": "27.08.2026 13:55:50",
    "source": "chatapp"
  }'
```

Exemplo de chamada retrocompatível com `closed_at` e `session_started_at` em
ISO:

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
    "source": "chatapp"
  }'
```

Data inválida retorna erro de validação explícito:

```json
{
  "success": false,
  "error": "invalid_closed_at",
  "message": "closed_at must be a valid date in ISO format or ChatApp format DD.MM.YYYY HH:MM:SS"
}
```

Origem inválida retorna erro de validação:

```json
{
  "success": false,
  "error": "invalid_source",
  "message": "source must be chatapp or bitrix24"
}
```

## Configuração

Defina no ambiente Vercel, sem versionar segredos:

- `CHATAPP_INTERNAL_TOKEN` (já usado pelas rotas ChatApp);
- `CHATAPP_API_BASE_URL`, `CHATAPP_COMPANY_ID`;
- `CHATAPP_EMAIL`, `CHATAPP_PASSWORD`, `CHATAPP_APP_ID`;
- `CHATAPP_ACCESS_TOKEN`, `CHATAPP_ACCESS_TOKEN_END_TIME`;
- `CHATAPP_REFRESH_TOKEN`, `CHATAPP_REFRESH_TOKEN_END_TIME`;
- `CHATAPP_EVALUATION_BLOCK_INTERNAL_ASSESSOR`, opcional; quando `true`,
  bloqueia avaliação e gravação de atendimentos do assessor interno configurado
  no código;
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `EVALUATION_PROMPT_FILE`;
- `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_SHEET_NAME`;
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.

`EVALUATION_PROMPT_FILE` aponta para um arquivo versionado no projeto e é o
modo preferencial para local e Vercel. `EVALUATION_PROMPT` permanece apenas
como fallback legado. A conta de serviço deve ter acesso de **Editor** à
planilha e o escopo Google Sheets API precisa estar habilitado no projeto dela.
Crie a aba configurada já com os cabeçalhos, nesta ordem: `ChatID`, `Nome do
Responsável`, `Horário`, `Nome do Cliente`, `Nota`, `Justificativa`,
`Textos Captados`, `Origem` (A:H).

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
página, inclusive o cursor opaco `nextPage` do ChatApp, e aceita futuramente `session_started_at` quando houver webhook
`chatStatus`. Por padrão, `closed_at` e `session_started_at` recebem offset de
`+3h` antes do filtro e da chave salva na planilha, porque o datetime emitido
pelo ChatApp neste fluxo chega deslocado. Ajuste
`CHATAPP_EVALUATION_TIME_OFFSET_HOURS=0` se o Scenario passar ISO UTC correto.
Antes desse ajuste, as datas são normalizadas por um parser único que aceita
ISO e `DD.MM.YYYY HH:MM:SS` sem inverter dia e mês.

A OpenAI não recebe o payload cru de `/messages`. O backend transforma a lista
em um transcript normalizado com horários, `CLIENTE`, `ASSESSOR` e
`OUTRO PARTICIPANTE`. Mensagens de sistema/automação, comandos `/`, Router,
Pipedrive, LOOP, NPS e mensagens sem autoria humana verificável não entram na
nota. Telefones, e-mails e CPFs evidentes são removidos do transcript enviado à
OpenAI; binários viram um marcador simples. Se mais de um funcionário humano
responder na conversa, o endpoint avalia até os dois participantes com mais
mensagens, mantendo o responsável atual como prioridade quando ele participou.
A janela do transcript é testada tanto na forma bruta enviada pelo ChatApp
quanto na forma ajustada pelo offset configurado; o backend usa a que realmente
preserva mensagens humanas antes de concluir que não há atendimento avaliável.
A planilha também recebe a coluna `Textos Captados`, preenchida com o mesmo
recorte filtrado usado pela IA, no formato `Autor - HH:MM - Texto`, uma
mensagem por linha.
A coluna `Origem` recebe somente `ChatApp` ou `Bitrix24`, derivados do campo
`source` do payload.
Quando `CHATAPP_EVALUATION_BLOCK_INTERNAL_ASSESSOR=true`, candidatos de
avaliação identificados pelo telefone interno bloqueado ou pelo creator ID
interno bloqueado são removidos antes da chamada à IA e antes da gravação no
Sheets. Se todos os candidatos forem bloqueados, a rota retorna `not_evaluable`
com motivo `blocked_assessor`.
A chamada Responses usa `store: false` e JSON Schema estrito para `avaliavel`,
`nota` inteira de 1 a 5 e uma `justificativa` técnica de até 900 caracteres,
explicando acertos, erros identificados, impacto no cliente e motivo da nota.

Erros retornam JSON estruturado e logs sem tokens nem transcript. `not_evaluable`
é um resultado bem-sucedido que não grava linha; os motivos possíveis incluem
ausência de responsável ou de mensagem humana atribuível ao responsável atual.

## Validação

Execute `npm run check`. A suíte não usa ChatApp, OpenAI nem Google reais e
cobre transcript, erros, idempotência, mensagens automáticas, autoria múltipla
e payload/autenticação.
