# Proxy Live Only

## Objetivo

Este arquivo documenta a versao nova da proxy que consulta o Pipedrive ao vivo, sem depender da planilha espelhada.

## Versao Recomendada: Vercel

Este workstation agora tem uma implementacao Node nativa para Vercel, sem Apps Script no caminho critico.

Arquivos principais:

- [lib/pipedrive-live-proxy.js](/home/davivieira/API_zendeskVercel/lib/pipedrive-live-proxy.js:1)
- [api/proxy.mjs](/home/davivieira/API_zendeskVercel/api/proxy.mjs:1)
- [server.js](/home/davivieira/API_zendeskVercel/server.js:1)
- [vercel.json](/home/davivieira/API_zendeskVercel/vercel.json:1)

O que mudou para performance:

- saiu o runtime local que executava o Apps Script em `vm`
- saiu o `curl` sincrono por requisicao
- entrou `fetch` nativo do Node/Vercel
- buscas enriquecidas passam a buscar detalhes em paralelo com limite de concorrencia
- metadados, detalhes de deals e respostas upstream usam cache em memoria por instancia
- respostas GET bem-sucedidas enviam `CDN-Cache-Control`/`Vercel-CDN-Cache-Control`
- o payload padrao de busca agora e enxuto para IA: sem `item`, sem `ai_context` e sem objetos `custom_fields*`

Variaveis obrigatorias na Vercel:

- `PIPEDRIVE_API_TOKEN`
- `PIPEDRIVE_PROXY_API_TOKEN`

Variaveis opcionais:

- `PIPEDRIVE_COMPANY_DOMAIN` com padrao `smartleiloes`
- `PIPEDRIVE_PROXY_CDN_CACHE_TTL_SECONDS` com padrao `30`
- `PIPEDRIVE_PROXY_UPSTREAM_CACHE_TTL_SECONDS` com padrao `60`
- `PIPEDRIVE_PROXY_DETAIL_CACHE_TTL_SECONDS` com padrao `60`
- `PIPEDRIVE_PROXY_METADATA_CACHE_TTL_SECONDS` com padrao `21600`
- `PIPEDRIVE_PROXY_CONCURRENCY` com padrao `8`
- `PIPEDRIVE_PROXY_FETCH_TIMEOUT_MS` com padrao `25000`
- `PIPEDRIVE_PROXY_FETCH_RETRIES` com padrao `3`

Rotas aceitas na Vercel:

```text
https://SEU_PROJETO.vercel.app/health
https://SEU_PROJETO.vercel.app/?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=...
https://SEU_PROJETO.vercel.app/api/v2/deals/search?api_token={PROXY_TOKEN}&term=...
https://SEU_PROJETO.vercel.app/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=...
```

Tambem e possivel trocar `api_token` por header:

```text
Authorization: Bearer {PROXY_TOKEN}
```

Busca combinada:

```text
https://SEU_PROJETO.vercel.app/api/v2/deals/search?property_code=8444411844190&email=cliente%40exemplo.com&limit=1
```

Parametros combinaveis:

- `property_code`
- `email`
- `cpf`
- `cnpj`
- `document` ou `documento`

Quando dois ou mais parametros forem enviados, a proxy cruza os criterios e retorna apenas deals que aparecem em todos eles.

Deploy rapido:

```bash
npm run check
vercel
vercel env add PIPEDRIVE_API_TOKEN
vercel env add PIPEDRIVE_PROXY_API_TOKEN
vercel --prod
```

Health local:

```bash
PIPEDRIVE_API_TOKEN=... PIPEDRIVE_PROXY_API_TOKEN=... npm start
```

```text
http://127.0.0.1:3001/health
```

## Legado Apps Script

Arquivo principal:

- [APPS_SCRIPT_PROXY_LIVE_ONLY.js](/home/davivieira/API_zendeskVercel/APPS_SCRIPT_PROXY_LIVE_ONLY.js:1)

Importante:

- publique este codigo em um projeto Apps Script separado
- nao cole este arquivo no mesmo projeto que ja usa [code.js](/home/davivieira/API_zendeskVercel/code.js:1), porque ambos definem `doGet`
- a proxy continua aceitando apenas `GET`
- o token real do Pipedrive deve ficar apenas em `Script Properties`

## Script Properties

Defina estas propriedades no novo projeto:

- `PIPEDRIVE_API_TOKEN`
- `PIPEDRIVE_PROXY_API_TOKEN`

## URL Base Atual

Use esta Web App publicada:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec
```

## Execucao Local Com Node E Ngrok

Arquivos locais:

- [server.js](/home/davivieira/API_zendeskVercel/server.js:1)
- [start_local_proxy_ngrok.sh](/home/davivieira/API_zendeskVercel/start_local_proxy_ngrok.sh:1)

Variaveis obrigatorias:

- `PIPEDRIVE_API_TOKEN`
- `PIPEDRIVE_PROXY_API_TOKEN`

Subir apenas o servidor local:

```bash
PIPEDRIVE_API_TOKEN=... \
PIPEDRIVE_PROXY_API_TOKEN=... \
PORT=3001 \
node server.js
```

Subir servidor + ngrok:

```bash
PIPEDRIVE_API_TOKEN=... \
PIPEDRIVE_PROXY_API_TOKEN=... \
PORT=3001 \
./start_local_proxy_ngrok.sh
```

Health local:

```text
http://127.0.0.1:3001/health
```

Exemplo local de busca:

```text
http://127.0.0.1:3001/?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=93746270510&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=1
```

## Endpoints Mantidos

A nova proxy preserva estes endpoints:

- `/health`
- `/api/v2/deals`
- `/api/v2/deals/{id}`
- `/api/v2/deals/products`
- `/api/v2/deals/search`
- `/api/v2/persons`
- `/api/v2/persons/{id}`
- `/api/v2/organizations`
- `/api/v2/organizations/{id}`
- `/api/v2/pipelines`
- `/api/v2/stages`
- `/v1/users`
- `/v1/dealFields`

## Casos de Teste Separados

Substitua apenas:

- `{PROXY_TOKEN}` pelo token publico da proxy

### 1. Codigo do imovel

Valor de teste:

```text
1234567890123
```

URL:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=1234567890123&fields=custom_fields,title&exact_match=true&search_by=property_code&limit=10
```

### 2. CPF ou CNPJ no mesmo campo

Observacao:

- `search_by=cpf` continua funcionando para CPF com ou sem mascara
- `search_by=cnpj` passa a funcionar para CNPJ com ou sem mascara
- ambos consultam o mesmo custom field de documento no Pipedrive

Valor de teste:

```text
10174861664
```

URL:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=10174861664&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=10
```

Exemplo de CNPJ:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=58.131.488/0001-76&fields=custom_fields,title&exact_match=true&search_by=cnpj&limit=10
```

### 3. Email

Valor de teste:

```text
davivieira.smart@gmail.com
```

URL:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=davivieira.smart%40gmail.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=10
```

## O Que Validar Depois Do Deploy

Checklist rapido:

- a raiz `/exec` deve mostrar `mode: "readonly_live_upstream"`
- a raiz `/exec` deve mostrar `data_source: "pipedrive_live"`
- a lista de `filters` deve conter `search_by`
- `GET /health` deve responder `success: true`
- os testes acima devem responder sem depender da planilha

## Payload Enxuto Para IA

Na versao Vercel, o retorno de `/api/v2/deals/search` passa a priorizar um payload curto e legivel.

Fica no item de busca:

- `deal`
- `matched_by`
- `search_term_normalized`
- `correlation_found`
- `result_score`, quando existir

Sai do payload:

- `item`
- `ai_context`
- `deal.ai_summary`
- `deal.custom_fields`
- `deal.custom_fields_readable`
- `deal.custom_fields_meta`
- `deal.custom_fields_by_name`
- `deal.custom_fields_raw_by_name`

O objeto `deal` fica neste formato geral:

```json
{
  "id": 123,
  "title": "...",
  "status": "open",
  "property_code": "8444411844190",
  "person_name": "...",
  "pipeline": {"id": 5, "name": "PRÉ ARREMATAÇÃO"},
  "stage": {"id": 105, "name": "..."},
  "updated_at": "2026-03-13T15:32:13Z",
  "fields": {
    "Endereço": "...",
    "Valor: Total da Proposta": {"value": 100000, "currency": "BRL"}
  },
  "workflow": {
    "statuses": {"Triagem": "Em andamento"},
    "completion_dates": {"Triagem": "2026-01-10"}
  },
  "notes": [
    {"id": 1, "value": "Texto da nota"}
  ]
}
```

Regras de campos:

- `workflow.statuses` recebe somente campos `Status: {{ETAPA}}`
- `workflow.completion_dates` recebe somente campos `Data término: {{ETAPA}}`
- `fields` recebe apenas campos unicos ou coringas relevantes, como endereco, matricula, valores, dados do imovel e dados principais do arrematante
- campos vazios, nulos e objetos tecnicos ficam ocultos

### Rastreabilidade da correlacao

No `/api/v2/deals/search`, a proxy agora devolve um resumo curto da correlacao:

- `data.search_trace.matched_by`
- `data.search_trace.search_term_normalized`
- `data.search_trace.correlation_found`

Cada item retornado em `data.items` tambem repete:

- `matched_by`
- `search_term_normalized`
- `correlation_found`

## Casos De Uso Para Encaminhar

Substitua apenas `{PROXY_TOKEN}` pelo token publico da proxy.

### Dados com correlacao

| Email | Documento | Codigo do imovel | Busca por email | Busca por documento | Busca por imovel |
| --- | --- | --- | --- | --- | --- |
| `guaraci.nakamura@gmail.com` | `58.131.488/0001-76` | `8444411844190` | [email](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=guaraci.nakamura%40gmail.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=10) | [cnpj](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=58.131.488%2F0001-76&fields=custom_fields,title&exact_match=true&search_by=cnpj&limit=10) | [imovel](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=8444411844190&fields=custom_fields,title&exact_match=true&search_by=property_code&limit=10) |
| `asfleiloes@gmail.com` | `975.318.550-20` | `8787708246250` | [email](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=asfleiloes%40gmail.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=10) | [cpf](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=975.318.550-20&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=10) | [imovel](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=8787708246250&fields=custom_fields,title&exact_match=true&search_by=property_code&limit=10) |
| `elianemarial@gmail.com` | `93746270510` | `8444405693320` | [email](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=elianemarial%40gmail.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=10) | [cpf](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=93746270510&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=10) | [imovel](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=8444405693320&fields=custom_fields,title&exact_match=true&search_by=property_code&limit=10) |
| `metaluizotavio@gmail.com` | `88382630782` | `8555506078801` | [email](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=metaluizotavio%40gmail.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=10) | [cpf](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=88382630782&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=10) | [imovel](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=8555506078801&fields=custom_fields,title&exact_match=true&search_by=property_code&limit=10) |
| `hlbomm@gmail.com` | `041.601.669-38` | `8787702194470` | [email](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=hlbomm%40gmail.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=10) | [cpf](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=041.601.669-38&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=10) | [imovel](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=8787702194470&fields=custom_fields,title&exact_match=true&search_by=property_code&limit=10) |

### Sem dados

| Email | Documento | Codigo do imovel | Busca por email | Busca por documento | Busca por imovel |
| --- | --- | --- | --- | --- | --- |
| `d2206304@gmail.com` | `814.161.136-49` | `8444451623283` | [email](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=d2206304%40gmail.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=10) | [cpf](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=814.161.136-49&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=10) | [imovel](https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={PROXY_TOKEN}&term=8444451623283&fields=custom_fields,title&exact_match=true&search_by=property_code&limit=10) |

## Observacao Sobre Performance

Os tempos de resposta da versao live only devem ser medidos somente depois do deploy desta nova Web App.

Os testes antigos feitos na proxy ja publicada nao valem para esta implementacao nova.
