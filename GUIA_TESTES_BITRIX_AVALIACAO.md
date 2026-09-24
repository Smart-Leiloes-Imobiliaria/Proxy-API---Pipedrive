# Guia de retomada e testes — avaliação Bitrix24

Este roteiro retoma a integração após a exclusão da aplicação local anterior.
Ele limita toda a homologação aos chats `64395` e `67331` e não altera o bot de
Triagem `18803`, a rota produtiva de webhooks nem as notificações do projeto
`smartcaixa-bitrix-webhook-jhonatan`.

## 1. Retrospecto

O proxy já possui quatro rotas Bitrix24:

- `POST /api/bitrix/install`: recebe a instalação OAuth, cifra os tokens no
  Supabase e confirma o binding de `ONSESSIONFINISH`;
- `POST /api/bitrix/events`: autentica o evento, aplica as allowlists e cria um
  job único por portal/sessão;
- `GET|POST /api/bitrix/processar-fila`: processa e reconcilia os jobs;
- `POST /api/bitrix/avaliar-atendimento`: permite `dry_run`, avaliação manual e
  reprocessamento controlado.

O histórico é consultado por `SESSION_ID`, normalizado, limpo de mensagens de
sistema/bot e dados pessoais evidentes, avaliado pela OpenAI e gravado na mesma
aba A:I usada pelo ChatApp. O `ChatID` contém somente o número do chat e a coluna
seguinte recebe o link direto para o diálogo.

A aplicação anterior foi instalada e o binding apareceu como `bound`, mas
nenhum job real de `OnSessionFinish` chegou antes de ela ser excluída. Assim, o
binding técnico foi comprovado; a entrega do evento pelo `livechat` nativo não.

## 2. Estratégia de gatilho

Use `OnSessionFinish` nesta rodada como gatilho imediato de homologação, mas não
o considere a única garantia arquitetural. A documentação do Bitrix24 restringe
o evento aos conectores destinados à aplicação, enquanto os chats testados usam
o conector nativo `livechat`.

O projeto `smartcaixa-bitrix-webhook-jhonatan` oferece a contingência correta:
se o evento não chegar, o módulo Chat Analytics, que já sincroniza sessões
oficiais da linha `19`, deverá disparar o proxy quando identificar uma sessão
fechada. Essa ponte é uma evolução posterior e exige contrato interno
autenticado; os dois projetos atualmente não compartilham a tabela analítica.

## 3. Criar novamente a aplicação local

No Bitrix24, crie uma aplicação local com:

- tipo: **Servidor**;
- caminho de instalação inicial:
  `https://api-zendesk-vercel-proxy.vercel.app/api/bitrix/install`;
- opção **Application completes the installation itself**: desmarcada;
- caminho do manipulador:
  `https://api-zendesk-vercel-proxy.vercel.app/api/bitrix/events`;
- permissão: **Canais Abertos (`imopenlines`)**;
- item de menu e suporte mobile: desnecessários.

Não adicione `imbot`, não registre outro bot e não altere o bot `18803`.

Ao criar a aplicação, o callback deve substituir no Supabase os tokens da
instalação anterior para o mesmo portal e tentar novamente o binding.

## 4. Atualizar as credenciais

Depois que o Bitrix24 mostrar as novas credenciais:

1. substitua `BITRIX_CLIENT_ID` e `BITRIX_CLIENT_SECRET` em `.env.avaliar`;
2. copie para `BITRIX_MEMBER_ID` e `BITRIX_EXPECTED_MEMBER_ID` o `member_id`
   confirmado pelo novo callback. Na retomada de 24/09, os dois valores locais
   ainda não correspondiam à instalação persistida; eles não são o ID `9` do
   usuário do webhook;
3. mantenha localmente:

   ```dotenv
   BITRIX_ALLOWED_CHAT_IDS=64395,67331
   BITRIX_ALLOWED_SESSION_IDS=
   BITRIX_ALLOWED_LINE_IDS=
   BITRIX_ALLOWED_CONNECTORS=livechat
   ```

4. atualize as duas credenciais, os identificadores do portal se necessário e a
   allowlist também em **Vercel Production**;
5. gere um novo deployment, pois editar variáveis não altera deployments já
   existentes.

Nunca envie os valores das credenciais por chat, commit ou captura de tela.

## 5. Validação técnica antes das conversas

Execute:

```bash
npm ci
npm run check
node --env-file=.env --env-file=.env.avaliar server.js
```

Em outro terminal, leia o token sem colocá-lo no histórico do shell:

```bash
read -rsp "BITRIX_INTERNAL_TOKEN: " BITRIX_TEST_TOKEN
```

Teste o primeiro chat sem OpenAI ou escrita na planilha:

```bash
curl -sS -X POST http://127.0.0.1:3001/api/bitrix/avaliar-atendimento \
  -H "Authorization: Bearer $BITRIX_TEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"chat_id":64395,"source":"bitrix24","dry_run":true}'
```

Repita para o segundo:

```bash
curl -sS -X POST http://127.0.0.1:3001/api/bitrix/avaliar-atendimento \
  -H "Authorization: Bearer $BITRIX_TEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"chat_id":67331,"source":"bitrix24","dry_run":true}'
unset BITRIX_TEST_TOKEN
```

São resultados técnicos válidos `dry_run` e `not_evaluable`. O segundo significa
que o histórico consultado não continha mensagens humanas atribuíveis depois
dos filtros; não representa falha de OAuth.

## 6. Teste automático controlado

Teste um chat de cada vez:

1. abra uma nova sessão como cliente no chat escolhido;
2. envie pelo menos uma mensagem do cliente;
3. faça um assessor humano responder manualmente;
4. finalize a sessão pelo Contact Center;
5. aguarde até dois minutos;
6. consulte a fila sem acessar tokens:

   ```sql
   select chat_id, session_id, status, attempts, last_error,
          received_at, completed_at
     from public.bitrix_evaluation_jobs
    where chat_id in (64395, 67331)
    order by received_at desc
    limit 20;
   ```

7. confira na planilha uma nova linha com `Origem = Bitrix24`, o ChatID correto
   e o link direto correspondente;
8. somente depois repita no outro chat.

Não use `force=true` durante a homologação. Não preencha
`BITRIX_ALLOWED_LINE_IDS=19`, pois isso liberaria todos os chats da linha.

## 7. Critério de decisão

| Evidência | Interpretação | Próxima ação |
|---|---|---|
| instalação `bound` e job criado | evento entregue | validar avaliação e repetir no segundo chat |
| job `completed` | fluxo completo | conferir linha e idempotência no Sheets |
| job `not_evaluable` | evento funcionou, conteúdo foi filtrado | revisar apenas o transcript da sessão de teste |
| job `failed` | evento funcionou, processamento falhou | usar `last_error` sanitizado e executar o worker após corrigir |
| instalação `bound`, sessão encerrada e nenhum job | `OnSessionFinish` não chegou | confirmar no Chat Analytics e adotar a ponte `webhook-jhonatan -> proxy` |

Se ambos os chats encerrarem sem job, não recrie repetidamente a aplicação. O
resultado deve ser registrado como limitação do conector nativo e o gatilho
produtivo deve migrar para a reconciliação já existente no Chat Analytics.

## 8. Encerramento da homologação

Considere o gatilho aprovado somente quando houver, para pelo menos um dos chats:

- callback da nova instalação salvo;
- binding confirmado;
- job criado automaticamente após encerramento;
- processamento concluído sem exposição de dados sensíveis;
- linha correta no Sheets;
- segunda chamada ou evento repetido sem duplicação.
