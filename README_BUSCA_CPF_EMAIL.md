# Tutorial de Busca de Deal por CPF e Email

## Objetivo

Este fluxo permite encontrar uma Deal usando:

- CPF do cliente
- email do cliente

A busca usa o mesmo endpoint ja existente:

```text
GET /api/v2/deals/search
```

Nao foi criada uma rota nova. A diferenca esta na estrategia da proxy live-only quando `exact_match=true`.

## URL Base Atual

Use esta Web App publicada:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec
```

## Por que essa abordagem foi escolhida

Antes de implementar, o payload atual da proxy foi avaliado.

Pontos importantes:

- o endpoint oficial de busca do Pipedrive devolve um item de busca mais enxuto
- a proxy ja enriquece a resposta com `deal`, `custom_fields_by_name`, `custom_fields_meta`, `ai_summary` e `ai_context`
- o email e o CPF podem apontar para a pessoa, e a pessoa pode ter uma ou mais deals

Por isso, a melhor abordagem para CPF e email foi:

1. normalizar o termo por tipo
2. consultar o search oficial de deals
3. consultar a pessoa pelo identity search quando `search_by=cpf` ou `search_by=email`
4. buscar deals adicionais por `person_id`
5. unificar, deduplicar e enriquecer o payload final

Assim a integracao ganha:

- busca atualizada em tempo real
- payload mais completo
- menos dependencia de espelho sincronizado

## Regras de deteccao

### Busca por email

Quando `term` parece um email, a proxy:

- normaliza com `trim + lowercase`
- tenta o search oficial de deals
- tenta localizar a pessoa no Pipedrive
- traz as deals ligadas ao `person_id` encontrado

Exemplo:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={TOKEN}&term=cliente@exemplo.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=1
```

### Busca por CPF

Quando `term` parece um CPF, a proxy:

- compara apenas os digitos
- aceita CPF com ou sem mascara
- tenta localizar a pessoa no Pipedrive por `custom_fields`
- traz as deals ligadas ao `person_id` encontrado

Exemplos equivalentes:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={TOKEN}&term=12345678901&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=1
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={TOKEN}&term=123.456.789-01&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=1
```

## Parametro opcional `search_by`

Voce pode deixar a proxy em modo automatico ou forcar o tipo da busca.

Valores aceitos:

- `cpf`
- `email`
- `property_code`

Se `search_by` nao for enviado, a proxy tenta detectar automaticamente.

Recomendacao:

- use `search_by=cpf` quando o CPF vier sem mascara
- use `search_by=email` quando quiser garantir que a busca nao sera interpretada de outra forma

## Ambiguidade com 11 digitos

Um termo com `11` digitos puros pode ser:

- CPF
- codigo do imovel

No modo automatico, a proxy tenta os dois caminhos.

Se quiser forcar apenas CPF:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={TOKEN}&term=12345678901&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=1
```

## Formato recomendado da chamada

Para o fluxo da Zendesk, prefira sempre:

```text
https://script.google.com/macros/s/AKfycbxt9sJU6kiTTHW2bmIt60-w8H-MBhjEeRvAZCNWe-txNd9yNuftJhbFMSfNOqfc7Pl5/exec?path=/api/v2/deals/search&api_token={TOKEN}&term={VALOR}&fields=custom_fields,title&exact_match=true&limit=1
```

Se o valor for CPF ou email, adicione `search_by` quando quiser tornar o comportamento explicito.

## O que voce recebe na resposta

Quando a busca encontra a Deal, a resposta vem enriquecida com:

- `item`
- `deal`
- `deal.custom_fields_by_name`
- `deal.custom_fields_meta`
- `deal.ai_summary`
- `ai_context`

Exemplo resumido:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "item": {
          "id": 9809,
          "type": "deal",
          "title": "SC, ARARANGUA, 8444423082222, ..."
        },
        "deal": {
          "id": 9809,
          "custom_fields_by_name": {
            "CPF do Cliente": "123.456.789-01",
            "E-mail do Cliente": "cliente@exemplo.com"
          },
          "ai_summary": {
            "contacts": {
              "CPF do Cliente": "123.456.789-01",
              "E-mail do Cliente": "cliente@exemplo.com"
            }
          }
        }
      }
    ]
  }
}
```

## Checklist rapido de teste

Teste estes cenarios:

1. CPF com mascara
2. CPF sem mascara
3. email em lowercase
4. email em uppercase ou mixed-case
5. termo de 11 digitos com `search_by=cpf`
6. termo inexistente para confirmar fallback

## Limitacoes

- a busca por CPF depende de o campo estar pesquisavel no fluxo de `persons/search` ou de haver match direto nas deals relacionadas
- email e CPF podem apontar para mais de uma deal da mesma pessoa
- a deteccao automatica pode ficar ambigua em termos numericos de 11 digitos

Quando houver ambiguidade, prefira enviar `search_by`.
