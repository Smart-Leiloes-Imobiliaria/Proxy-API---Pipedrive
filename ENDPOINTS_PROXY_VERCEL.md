# Endpoints Proxy Pipedrive na Vercel

## Base URL

```text
https://api-zendesk-vercel-proxy.vercel.app
```

## Token da Proxy

```text
7a656e6465736b2d696e666f6375736378
```

Use o token por query string:

```text
?api_token=7a656e6465736b2d696e666f6375736378
```

## O que tem de novo

- Proxy agora esta hospedada na Vercel, sem depender do Apps Script para responder as buscas.
- Payload de busca ficou enxuto para IA.
- Removidos do retorno padrao: `item`, `ai_context`, `deal.ai_summary`, `custom_fields`, `custom_fields_readable`, `custom_fields_meta`, `custom_fields_by_name` e outros objetos tecnicos grandes.
- `notes` agora retorna no formato organizado:

```json
[
  {
    "id": 1,
    "value": "Texto da nota"
  }
]
```

- Agora e possivel pesquisar por dois ou mais parametros ao mesmo tempo.
- Exemplo ideal: `property_code` + `email`, retornando somente a deal que cruza os dois criterios.
- `workflow.statuses` retorna somente campos `Status: {{ETAPA}}`.
- `workflow.completion_dates` retorna somente campos `Data termino: {{ETAPA}}`.
- `fields` retorna apenas campos principais e uteis para IA, como endereco, matricula, valores, dados do imovel e dados principais do arrematante.

## Health Check

```text
GET /health
```

Exemplo:

```bash
curl -sS "https://api-zendesk-vercel-proxy.vercel.app/health"
```

## Buscar deal por codigo do imovel

```text
GET /api/v2/deals/search?term={CODIGO_IMOVEL}&search_by=property_code&limit=1
```

Exemplo:

```bash
curl -sS "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?api_token=7a656e6465736b2d696e666f6375736378&term=1234567890123&fields=custom_fields,title&exact_match=true&search_by=property_code&limit=1"
```

## Buscar deal por e-mail

```text
GET /api/v2/deals/search?term={EMAIL}&search_by=email&limit=1
```

Exemplo:

```bash
curl -sS "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?api_token=7a656e6465736b2d696e666f6375736378&term=davivieira.smart%40gmail.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=1"
```

## Buscar deal por CPF

```text
GET /api/v2/deals/search?term={CPF}&search_by=cpf&limit=1
```

Exemplo:

```bash
curl -sS "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?api_token=7a656e6465736b2d696e666f6375736378&term=10174861664&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=1"
```

## Buscar deal por CNPJ

```text
GET /api/v2/deals/search?term={CNPJ}&search_by=cnpj&limit=1
```

Exemplo:

```bash
curl -sS "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?api_token=7a656e6465736b2d696e666f6375736378&term=58.131.488%2F0001-76&fields=custom_fields,title&exact_match=true&search_by=cnpj&limit=1"
```

## Busca combinada por codigo do imovel + e-mail

```text
GET /api/v2/deals/search?property_code={CODIGO_IMOVEL}&email={EMAIL}&limit=1
```

Exemplo:

```bash
curl -sS "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?api_token=7a656e6465736b2d696e666f6375736378&property_code=1234567890123&email=davivieira.smart%40gmail.com&limit=1"
```

## Busca combinada por codigo do imovel + CPF

```text
GET /api/v2/deals/search?property_code={CODIGO_IMOVEL}&cpf={CPF}&limit=1
```

Exemplo:

```bash
curl -sS "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?api_token=7a656e6465736b2d696e666f6375736378&property_code=1234567890123&cpf=10174861664&limit=1"
```

## Busca combinada por codigo do imovel + documento

`document` ou `documento` aceita CPF ou CNPJ. A proxy detecta o tipo pelo tamanho do documento.

```text
GET /api/v2/deals/search?property_code={CODIGO_IMOVEL}&document={CPF_OU_CNPJ}&limit=1
```

Exemplo:

```bash
curl -sS "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?api_token=7a656e6465736b2d696e666f6375736378&property_code=1234567890123&document=10174861664&limit=1"
```

## Parametros combinaveis

- `property_code`
- `email`
- `cpf`
- `cnpj`
- `document`
- `documento`

Quando dois ou mais parametros combinaveis forem enviados, a proxy cruza os resultados e retorna apenas deals que aparecem em todos os criterios.

## Campos removidos do retorno novo

Estes objetos foram removidos do payload padrao por serem grandes, redundantes ou tecnicos demais para uso direto por IA:

- `item`
- `ai_context`
- `deal.ai_summary`
- `deal.custom_fields`
- `deal.custom_fields_readable`
- `deal.custom_fields_meta`
- `deal.custom_fields_by_name`
- `deal.custom_fields_raw_by_name`

## Campos principais que permanecem

- `deal.id`
- `deal.title`
- `deal.status`
- `deal.property_code`
- `deal.person_name`
- `deal.pipeline`
- `deal.stage`
- `deal.updated_at`
- `deal.fields`
- `deal.workflow`
- `deal.notes`
- `matched_by`
- `search_term_normalized`
- `correlation_found`
- `data.search_trace`
