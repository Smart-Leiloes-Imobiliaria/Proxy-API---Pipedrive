# Pipedrive Readonly Proxy API

## Visao Geral

Esta proxy expõe endpoints de leitura compatíveis com o Pipedrive sem entregar o token real da conta.

Objetivos:

- mascarar o Pipedrive para integracoes terceiras
- manter somente leitura
- responder rápido para o fluxo da Zendesk
- devolver um payload mais fácil de interpretar por IA

## URL Base

Use a URL publicada da Web App:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec
```

Implementacao publicada atual:

- modo: `readonly_live_upstream`
- fonte: `pipedrive_live`
- documentacao especifica desta versao: [README_PROXY_LIVE_ONLY.md](/home/davivieira/API_zendeskVercel/README_PROXY_LIVE_ONLY.md:1)

Observacao:

- esta URL atual aponta para a versao live-only
- as secoes abaixo que mencionam planilha espelhada descrevem a implementacao anterior

Formato das chamadas:

```text
{BASE_URL}?path={ENDPOINT}&api_token={TOKEN_DA_PROXY}
```

## Autenticacao

Todas as rotas protegidas exigem:

```text
api_token={TOKEN_DA_PROXY}
```

Importante:

- o token da proxy nao e o token real do Pipedrive
- a proxy aceita apenas `GET`

## Rotas Suportadas

### Health

```text
GET /health
```

Exemplo:

```text
{BASE_URL}?path=/health
```

### Deals

```text
GET /api/v2/deals
GET /api/v2/deals/{id}
GET /api/v2/deals/products
GET /api/v2/deals/search
```

### Pessoas

```text
GET /api/v2/persons
GET /api/v2/persons/{id}
```

### Organizacoes

```text
GET /api/v2/organizations
GET /api/v2/organizations/{id}
```

### Metadados

```text
GET /api/v2/pipelines
GET /api/v2/stages
GET /v1/users
GET /v1/dealFields
```

## Parametros de Consulta

Os principais parametros aceitos sao:

- `status`
- `ids`
- `owner_id`
- `person_id`
- `org_id`
- `pipeline_id`
- `stage_id`
- `updated_since`
- `updated_until`
- `filter_id`
- `limit`
- `cursor`
- `sort_by`
- `sort_direction`
- `term`
- `fields`
- `exact_match`
- `search_by`

## Como a Proxy Responde Rapido

### 1. Consulta de deal por ID

`GET /api/v2/deals/{id}` nao varre a planilha inteira.

Ela faz:

- lookup direto da coluna `Negócio - ID`
- leitura de apenas uma linha
- cache curto da linha da deal
- cache mais longo do indice `deal_id -> row`

### 2. Busca exata por codigo do imovel, CPF ou email

Para o caso principal da Zendesk:

```text
GET /api/v2/deals/search?term={VALOR_DA_BUSCA}&fields=custom_fields,title&exact_match=true
```

quando `exact_match=true`, a proxy tenta um fast-path na planilha para tres casos:

- codigo do imovel numerico
- CPF com ou sem mascara
- email do cliente

Como funciona:

- codigo do imovel: procura direto na coluna `Negócio - Número do Imóvel`
- CPF: procura nas colunas customizadas cujo nome contenha `CPF`
- email: procura nas colunas customizadas cujo nome contenha `Email` ou `E-mail`
- CPF e normalizado para comparar apenas digitos
- email e comparado com `trim + lowercase`
- monta o payload a partir da linha espelhada
- responde com `deal` completo e `ai_context`

Observacao importante:

- se o termo tiver `11` digitos puros, ele pode ser interpretado como CPF ou codigo do imovel
- para forcar um tipo especifico, use `search_by=cpf`, `search_by=email` ou `search_by=property_code`

Se a busca nao cair nesse caso otimizado, ou se nao houver match local, a proxy faz fallback para o endpoint oficial do Pipedrive.

### 3. Busca ampla / filtros

- `GET /api/v2/deals?filter_id=...` vai para o upstream do Pipedrive
- `GET /api/v2/deals?ids=...` pode usar lookup direto por ID quando a lista e pequena
- `GET /api/v2/deals/products?deal_ids=...` reaproveita esse mesmo lookup direto quando possivel

## Cache Atual

Os tempos de cache da versao atual sao:

- deal por ID: `300s`
- indice `deal_id -> row`: `1800s`
- busca exata por codigo de imovel / CPF / email: `300s`
- rotas readonly upstream: `300s`

Observacao:

- a base ja e um espelho sincronizado do Pipedrive
- portanto um cache curto adicional na leitura costuma ser aceitavel

## Fluxo Recomendado Para a Zendesk

Fluxo recomendado:

1. buscar a deal pelo codigo do imovel
2. ou buscar a deal pelo CPF do cliente
3. ou buscar a deal pelo email do cliente
4. usar o `deal.id` retornado
5. se precisar, consultar `/api/v2/deals/{id}` para detalhes completos

Exemplo por codigo do imovel:

```text
{BASE_URL}?path=/api/v2/deals/search&api_token={TOKEN}&term=8444423082222&fields=custom_fields,title&exact_match=true&limit=1
```

Exemplo por CPF:

```text
{BASE_URL}?path=/api/v2/deals/search&api_token={TOKEN}&term=12345678901&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=1
```

Exemplo por email:

```text
{BASE_URL}?path=/api/v2/deals/search&api_token={TOKEN}&term=cliente@exemplo.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=1
```

Se quiser confirmar detalhes:

```text
{BASE_URL}?path=/api/v2/deals/9809&api_token={TOKEN}
```

## Payload Enriquecido Para IA

A proxy preserva o payload bruto do Pipedrive e adiciona camadas mais legiveis.

### O que continua igual

- `custom_fields` continua com os hashes originais do Pipedrive
- `id`, `title`, `status`, `pipeline_id`, `stage_id` e demais campos da deal continuam existindo

### O que a proxy adiciona

- `custom_fields_readable`
- `custom_fields_by_name`
- `custom_fields_raw_by_name`
- `custom_fields_meta`
- `ai_summary`
- `ai_context`

### Significado dos campos adicionais

#### `custom_fields_readable`

Mesmos custom fields, mas com nome humano e valor mais legivel.

Exemplo:

```json
{
  "Status: Registro": "13. Finalizado",
  "Número do Imóvel": "8444423082222",
  "CPF do Cliente": "123.456.789-01",
  "E-mail do Cliente": "cliente@exemplo.com",
  "Executor: Registro": "Smart"
}
```

#### `custom_fields_by_name`

Alias equivalente de leitura por nome humano. Foi pensado para uso direto da IA.

#### `custom_fields_raw_by_name`

Mesmo campo humano, mas preservando o valor bruto quando possivel.

Exemplo:

```json
{
  "Status: Registro": 206
}
```

#### `custom_fields_meta`

Mapa por hash contendo:

- `name`
- `field_type`
- `raw_value`
- `display_value`
- `normalized_value`

Observacao:

- `custom_fields_meta` e um mapa tecnico por hash
- quando o metadata completo do campo estiver resolvido, ele traz nome e valores enriquecidos
- quando nao estiver resolvido, pode manter o hash e o valor bruto
- para IA, prefira `custom_fields_by_name` e `ai_summary`

Exemplo:

```json
{
  "6c8f6355237b0ae3d21972c1db9073cea458b1db": {
    "name": "Status: Registro",
    "raw_value": 206,
    "display_value": "13. Finalizado",
    "normalized_value": "Finalizado"
  }
}
```

#### `ai_summary`

Resumo pronto para a IA responder com menos engenharia de prompt.

Blocos principais:

- `identity`
- `process`
- `workflow`
- `property`
- `contacts`
- `financial`
- `dates`

Exemplo:

```json
{
  "ai_summary": {
    "identity": {
      "deal_id": 9809,
      "title": "SC, ARARANGUA, 8444423082222, RODRIGO JOSE DA SILVA FELIX",
      "property_code": "8444423082222",
      "person_name": "Rodrigo Jose da Silva Felix"
    },
    "workflow": {
      "statuses": {
        "Registro": "Finalizado",
        "ITBI": "Finalizado",
        "IPTU": "CND salva no Drive",
        "Condominio": "n/a"
      },
      "executors": {
        "Registro": "Smart"
      }
    }
  }
}
```

#### `ai_context`

Contexto complementar para uso pela IA no endpoint de busca.

Inclui:

- `summary`
- `identity`
- `process`
- `financial`
- `dates`
- `property`
- `workflow`
- `notes`

## Observacao Sobre Notas

No fast-path de busca por codigo do imovel, CPF ou email, a proxy responde direto da planilha espelhada.

Vantagem:

- resposta mais rapida

Trade-off:

- os snippets de `notes` do endpoint oficial de busca do Pipedrive podem nao vir nesse caminho rapido

Se a busca nao usar o caso otimizado, a proxy faz fallback para o upstream.

## Exemplos de Uso

### Buscar imovel pelo codigo

```text
GET {BASE_URL}?path=/api/v2/deals/search&api_token={TOKEN}&term=8444423082222&fields=custom_fields,title&exact_match=true&limit=1
```

### Buscar deal pelo CPF

```text
GET {BASE_URL}?path=/api/v2/deals/search&api_token={TOKEN}&term=12345678901&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=1
```

### Buscar deal pelo email

```text
GET {BASE_URL}?path=/api/v2/deals/search&api_token={TOKEN}&term=cliente@exemplo.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=1
```

### Buscar deal por ID

```text
GET {BASE_URL}?path=/api/v2/deals/9809&api_token={TOKEN}
```

### Buscar produtos da deal

```text
GET {BASE_URL}?path=/api/v2/deals/products&api_token={TOKEN}&deal_ids=9809
```

### Listar deals com filtro oficial do Pipedrive

```text
GET {BASE_URL}?path=/api/v2/deals&api_token={TOKEN}&filter_id=123
```

### Listar pessoas

```text
GET {BASE_URL}?path=/api/v2/persons&api_token={TOKEN}
```

### Listar organizations

```text
GET {BASE_URL}?path=/api/v2/organizations&api_token={TOKEN}
```

## Formato de Resposta

### Lista

```json
{
  "success": true,
  "data": [],
  "additional_data": {
    "pagination": {
      "limit": 10,
      "more_items_in_collection": false,
      "next_cursor": null
    }
  }
}
```

### Busca

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "result_score": 1,
        "item": {
          "id": 9809,
          "type": "deal",
          "title": "SC, ARARANGUA, 8444423082222, ..."
        },
        "deal": {
          "id": 9809,
          "custom_fields": {
            "5c3aac951d1281021e01c13aa7a11a449efeabd1": "8444423082222"
          },
          "custom_fields_by_name": {
            "Número do Imóvel": "8444423082222",
            "CPF do Cliente": "123.456.789-01",
            "E-mail do Cliente": "cliente@exemplo.com",
            "Status: Registro": "13. Finalizado"
          },
          "ai_summary": {
            "contacts": {
              "CPF do Cliente": "123.456.789-01",
              "E-mail do Cliente": "cliente@exemplo.com"
            },
            "workflow": {
              "statuses": {
                "Registro": "Finalizado"
              }
            }
          }
        },
        "ai_context": {
          "summary": {
            "workflow": {
              "statuses": {
                "Registro": "Finalizado"
              }
            }
          }
        }
      }
    ]
  },
  "additional_data": {
    "next_cursor": null
  }
}
```

### Erro

```json
{
  "success": false,
  "error": "Mensagem de erro",
  "error_info": "codigo_interno",
  "data": null,
  "additional_data": null
}
```

## Compatibilidade

O contrato publico preservado:

- mesma URL base da Web App
- mesmo `path`
- mesmo metodo `GET`
- mesma autenticacao por `api_token`
- mesmo payload base do Pipedrive

As adicoes sao complementares e nao removem os campos ja existentes.

## Limitacoes Conhecidas

- Apps Script sempre faz redirect `302` antes do JSON final
- o Google pode oscilar mais do que o Pipedrive em chamadas frias
- a base depende do espelho sincronizado da planilha
- algumas buscas amplas continuam mais lentas do que o Pipedrive oficial

## Checklist de Deploy

Quando houver alteracao na library:

1. publicar uma nova versao da library
2. no projeto do Web App, atualizar a versao da library para a nova publicada
3. salvar o projeto consumidor
4. fazer novo deploy do Web App
5. testar:

```text
{BASE_URL}?path=/health
{BASE_URL}?path=/api/v2/deals/search&api_token={TOKEN}&term=8444423082222&fields=custom_fields,title&exact_match=true&limit=1
{BASE_URL}?path=/api/v2/deals/search&api_token={TOKEN}&term=12345678901&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=1
{BASE_URL}?path=/api/v2/deals/search&api_token={TOKEN}&term=cliente@exemplo.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=1
{BASE_URL}?path=/api/v2/deals/9809&api_token={TOKEN}
```

## Boas Praticas Para Integracao

- ativar follow redirects no Postman
- preferir `limit=1` no fluxo da Zendesk
- preferir `exact_match=true` para codigo do imovel, CPF e email
- usar `search_by=cpf` quando o CPF for enviado sem mascara e tiver `11` digitos
- usar `search_by=email` quando quiser forcar busca apenas por email
- tratar `success=false` como erro de negocio valido
- usar `deal.ai_summary` ou `ai_context.summary` como fonte principal para a IA
- usar `custom_fields_by_name` como segunda fonte mais legivel para IA
- usar `custom_fields` apenas quando precisar do hash original do Pipedrive
