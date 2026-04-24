# Endpoints Proxy Pipedrive na Vercel

## Base URL

```text
https://api-zendesk-vercel-proxy.vercel.app
```

## Token da Proxy

```text
7a656e6465736b2d696e666f6375736378
```

Pode ser enviado por query string:

```text
?api_token=7a656e6465736b2d696e666f6375736378
```

Ou por header:

```text
Authorization: Bearer 7a656e6465736b2d696e666f6375736378
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
curl -sS \
  -H "Authorization: Bearer 7a656e6465736b2d696e666f6375736378" \
  "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?term=1234567890123&fields=custom_fields,title&exact_match=true&search_by=property_code&limit=1"
```

## Buscar deal por e-mail

```text
GET /api/v2/deals/search?term={EMAIL}&search_by=email&limit=1
```

Exemplo:

```bash
curl -sS \
  -H "Authorization: Bearer 7a656e6465736b2d696e666f6375736378" \
  "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?term=davivieira.smart%40gmail.com&fields=custom_fields,title&exact_match=true&search_by=email&limit=1"
```

## Buscar deal por CPF

```text
GET /api/v2/deals/search?term={CPF}&search_by=cpf&limit=1
```

Exemplo:

```bash
curl -sS \
  -H "Authorization: Bearer 7a656e6465736b2d696e666f6375736378" \
  "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?term=10174861664&fields=custom_fields,title&exact_match=true&search_by=cpf&limit=1"
```

## Buscar deal por CNPJ

```text
GET /api/v2/deals/search?term={CNPJ}&search_by=cnpj&limit=1
```

Exemplo:

```bash
curl -sS \
  -H "Authorization: Bearer 7a656e6465736b2d696e666f6375736378" \
  "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?term=58.131.488%2F0001-76&fields=custom_fields,title&exact_match=true&search_by=cnpj&limit=1"
```

## Busca combinada por codigo do imovel + e-mail

```text
GET /api/v2/deals/search?property_code={CODIGO_IMOVEL}&email={EMAIL}&limit=1
```

Exemplo:

```bash
curl -sS \
  -H "Authorization: Bearer 7a656e6465736b2d696e666f6375736378" \
  "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?property_code=1234567890123&email=davivieira.smart%40gmail.com&limit=1"
```

## Busca combinada por codigo do imovel + CPF

```text
GET /api/v2/deals/search?property_code={CODIGO_IMOVEL}&cpf={CPF}&limit=1
```

Exemplo:

```bash
curl -sS \
  -H "Authorization: Bearer 7a656e6465736b2d696e666f6375736378" \
  "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?property_code=1234567890123&cpf=10174861664&limit=1"
```

## Busca combinada por codigo do imovel + documento

`document` ou `documento` aceita CPF ou CNPJ. A proxy detecta o tipo pelo tamanho do documento.

```text
GET /api/v2/deals/search?property_code={CODIGO_IMOVEL}&document={CPF_OU_CNPJ}&limit=1
```

Exemplo:

```bash
curl -sS \
  -H "Authorization: Bearer 7a656e6465736b2d696e666f6375736378" \
  "https://api-zendesk-vercel-proxy.vercel.app/api/v2/deals/search?property_code=1234567890123&document=10174861664&limit=1"
```

## Parametros combinaveis

- `property_code`
- `email`
- `cpf`
- `cnpj`
- `document`
- `documento`

Quando dois ou mais parametros combinaveis forem enviados, a proxy cruza os resultados e retorna apenas deals que aparecem em todos os criterios.

## Modelo de payload

```json
{
    "success": true,
    "data": {
        "items": [
            {
                "result_score": 0.12856801,
                "deal": {
                    "id": 15759,
                    "title": "BH, MINAS GERAIS, 1234567890123, TESTE DAVI VIEIRA",
                    "status": "open",
                    "property_code": "1234567890123",
                    "person_name": "Davi Vieira",
                    "pipeline": {
                        "id": 6,
                        "name": "PÓS ARREMATAÇÃO"
                    },
                    "stage": {
                        "id": 136,
                        "name": "Triagem"
                    },
                    "updated_at": "2026-04-24T16:55:38Z",
                    "fields": {
                        "Modalidade": "Leilão Unico",
                        "Forma de Pagamento": "À vista e IGUAL ou ABAIXO de 30 salários mínimos (R$48.630)",
                        "Valor: Total da Proposta": {
                            "value": "70000",
                            "currency": "BRL"
                        },
                        "Valor: Recursos próprios": {
                            "value": "70000",
                            "currency": "BRL"
                        },
                        "Valor: Financiado": {
                            "value": "0",
                            "currency": "BRL"
                        },
                        "Valor: FGTS": {
                            "value": "0",
                            "currency": "BRL"
                        },
                        "Estado (selecionável)": "PI",
                        "Tipo de Imóvel": "Prédio",
                        "Número do Imóvel": "1234567890123",
                        "Número da matricula": "2222222",
                        "Endereço": "Rua Vítor Gonçalves, 280 - Floramar, Belo Horizonte - MG, Brasil",
                        "CPF do Proponente Principal": "10174861664",
                        "Cancelamento de Proposta - Última Atualização": "2026-02-03",
                        "Nome do Arrematante": "Davi Vieira",
                        "E-mail do Arrematante": "davivieira.smart@gmail.com",
                        "Telefone do Arrematante": "5531995611124"
                    },
                    "workflow": {
                        "statuses": {
                            "Triagem": "Triagem finalizada",
                            "CCV (À vista ABAIXO de 30 salários mín.)": "Finalizado",
                            "FGTS À Vista": "n/a",
                            "Financiamento / FGTS Financiado": "n/a",
                            "ITBI": "Finalizado",
                            "Titularidade": "Pendência na Baixa",
                            "Leilões": "Iniciar",
                            "Registro": "Pendência na Baixa",
                            "IPTU": "CND salva no Drive",
                            "Condomínio": "CND Salva no Drive",
                            "Desocupação": "Finalizado",
                            "Pagamento Assessoria": "Docs com Pendência"
                        },
                        "completion_dates": {
                            "Triagem": "2026-03-12",
                            "Contrato": "2026-04-20",
                            "ITBI": "2026-03-12",
                            "Titularidade": "2026-03-12",
                            "Registro": "2026-03-12",
                            "IPTU": "2026-03-12",
                            "Condomínio": "2026-03-12",
                            "Desocupação": "2026-03-12"
                        }
                    },
                    "notes": [
                        {
                            "id": 1,
                            "value": "Sistema: *ANÁLISE DA MATRICULA - ATUALIZAÇÕES DETALHADAS: - No. Matrícula: - Data de Construção: - Possui Habite-se? - Possui Convenção de condomínio? - Data de Compra: - Data de Consolidação da Propriedade: - Imóvel Foreiro?: - Possui Indisponibilidade/Penhora?: - Nome do Condomínio / CNPJ:"
                        },
                        {
                            "id": 2,
                            "value": "Sistema: *ANÁLISE JURÍDICA - ATUALIZAÇÕES DETALHADAS: 📆 Dados dos ex-mutuários: NOME: CPF: - 📄 Tribunal Competente: - 📄 Nº do processo:*, - 📄 Requerente:*, - 📄 Requerida:*, - 📄 Status:*, - *Conclusão:* (Informar se impacta o imóvel, última decisão, a favor de qual Parte é possível risco de cancelamento. Ex: “Não foi encontrado nenhuma Ação Judicial no CPF XXXXXXXX do ex-mutuário xxxxx contra a CEF no Tribunal competente”)."
                        },
                        {
                            "id": 3,
                            "value": "Sistema: 📌ATUALIZAÇÕES DETALHADAS - ANÁLISE DE MERCADO -"
                        },
                        {
                            "id": 4,
                            "value": "Sistema: 📌ATUALIZAÇÕES DETALHADAS - DILIGÊNCIA -"
                        },
                        {
                            "id": 5,
                            "value": "Sistema: 📌ATUALIZAÇÕES DETALHADAS - DÉBITOS DE PRÉ-ARREMATAÇÃO -"
                        },
                        {
                            "id": 6,
                            "value": "Sistema: *ANÁLISE DO IMÓVEL - ATUALIZAÇÕES DETALHADAS: - *Data da última vistoria da Caixa:* - *Data de validade da avaliação da Caixa: (Para realizar a venda futuramente poderá ser necessário solicitar nova avaliação)* - *Categoria:* (casa, prédio, terreno, etc) - *Endereço:* - *Link da localização no mapa:* - *Infraestrutura e Características da região:* (serviços públicos oferecidos) - *Idade estimada:* - *Condomínio:* (No. de pavimentos / Aptos por andar / No. de prédios) - *Vagas de Garagem:* (se é coberta ou descoberta) - *Área privativa / área construída:* - *Área de terreno:* (apenas Casas) (incluir tamanho, largura, profundidade) - *Divisão interna:* (cômodos) - *Infraestrutura:* (apenas Condomínio): - Indicar se, aparentemente, há ou não vícios de construção, danos graves e se possui ou não condições de habitabilidade. - Indicar se imóvel foi aceito ou não como Garantia - *Valor de avaliação da Caixa:* - *Informações complementares:* (incluir informações relevantes como, por exemplo, situação de ocupação, segurança, se foi encontrado pelo engenheiro, razão por ele nao ter sido aceito como garantia, etc)."
                        },
                        {
                            "id": 7,
                            "value": "Sistema: *DADOS DO EX-MUTUÁRIO (COM BASE NA MATRÍCULA)* - *CPF/CNPJ do Ex-mutuário:* - *Endereços do Ex-mutuário:* - *Telefones do Ex-mutuário:* - *CNPJs do Ex-mutuário + tels:*"
                        },
                        {
                            "id": 8,
                            "value": "Sistema: ❌ Criação de pasta do imóvel interrompida, pois o negócio não possui Cidade atribuida."
                        },
                        {
                            "id": 9,
                            "value": "Sistema: Comissão SMART atribuída: R$1.500,00 (5%) - Comissão ajustada para valor mínimo R$1.500"
                        },
                        {
                            "id": 10,
                            "value": "Sistema: Negócio não qualificado para cashback: Nem a pessoa, nem o cônjuge são alunos."
                        }
                    ]
                },
                "matched_by": "property_code",
                "search_term_normalized": "1234567890123",
                "correlation_found": true
            }
        ],
        "search_trace": {
            "matched_by": "property_code",
            "search_term_normalized": "1234567890123",
            "correlation_found": true
        }
    },
    "additional_data": {
        "next_cursor": null
    }
}
```

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

