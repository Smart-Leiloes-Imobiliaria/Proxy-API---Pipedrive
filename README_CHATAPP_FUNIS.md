# Consulta de imóveis para os funis do ChatApp

Endpoint:

```text
GET /api/chatapp/verificar-triagem-funis?id_chat=5591999999999
```

O único parâmetro funcional é `id_chat`, com o telefone do cliente. A
autenticação deve ser enviada preferencialmente no header:

```text
Authorization: Bearer <CHATAPP_INTERNAL_TOKEN>
```

O endpoint aceita telefone formatado, com ou sem DDI e com ou sem o nono
dígito. A resposta contém todos os imóveis/deals cujo campo
`Telefone do Arrematante` corresponde ao número.

## Resposta

```json
{
  "triagem": {
    "necessaria": "nao",
    "motivo": "cliente_em_esteira"
  },
  "cliente": {
    "telefone_consultado": "5591999999999",
    "quantidade_imoveis": 1
  },
  "imoveis": [
    {
      "item_id": "12345",
      "titulo": "Cliente - Imóvel 12345678",
      "numero_imovel": "12345678",
      "telefone": "5591999999999",
      "status": "open",
      "pipeline_id": "16",
      "etapa": "Análise em Andamento",
      "link": "https://smartleiloes.pipedrive.com/deal/12345",
      "atribuicoes": {
        "triagem_documentos": {
          "campo": "Atribuído: Triagem de Documentos",
          "valor": "Daniela Silva | Isadora Campos",
          "option_ids": ["2760"],
          "option_ids_nao_mapeados": [],
          "responsavel_identificado": "sim",
          "rotas": [
            {
              "delegacao_modo": "assignment",
              "routing_key": "TRIAGEM_DOCUMENTOS_DANIELA_ISADORA",
              "responsavel_destino_id": "",
              "responsavel_destino_nome": "Daniela Silva | Isadora Campos",
              "nota_funcionario": "",
              "motivo_delegacao": "atribuido_triagem_documentos_2760"
            }
          ]
        },
        "analise_credito": {
          "campo": "Atribuído: Análise de Crédito",
          "valor": "Thales Gabriel",
          "option_ids": ["2659"],
          "option_ids_nao_mapeados": [],
          "responsavel_identificado": "sim",
          "rotas": [
            {
              "delegacao_modo": "fixed",
              "routing_key": "ANALISE_CREDITO_THALES",
              "responsavel_destino_id": "78057",
              "responsavel_destino_nome": "Thales",
              "nota_funcionario": "",
              "motivo_delegacao": "atribuido_analise_credito_2659"
            }
          ]
        },
        "financiamento": {
          "campo": "Atribuído: Financiamento",
          "valor": "Marloon Santos",
          "option_ids": ["2804"],
          "option_ids_nao_mapeados": [],
          "responsavel_identificado": "sim",
          "rotas": [
            {
              "delegacao_modo": "fixed",
              "routing_key": "FINANCIAMENTO_MARLOON",
              "responsavel_destino_id": "98226",
              "responsavel_destino_nome": "Marloon",
              "nota_funcionario": "",
              "motivo_delegacao": "atribuido_financiamento_2804"
            }
          ]
        }
      }
    }
  ],
  "chatapp": {
    "fallback_necessario": "nao",
    "routing_key_fallback": "",
    "nota_funcionario": "",
    "preservar_atribuido_ao_encerrar": "sim",
    "reconsultar_ao_reabrir": "sim"
  },
  "resultado": {
    "motivo": "imoveis_encontrados"
  }
}
```

Todos os imóveis sempre retornam os três campos de atribuição. Como
`Atribuído: Triagem de Documentos` é multisseleção, `option_ids` e `rotas`
podem conter mais de um item.

## Fallback

Quando um campo está vazio ou contém uma opção não mapeada, a atribuição
correspondente retorna:

```json
{
  "valor": "",
  "option_ids": [],
  "responsavel_identificado": "nao",
  "rotas": [
    {
      "delegacao_modo": "assignment",
      "routing_key": "ATENDIMENTO_FALLBACK",
      "responsavel_destino_id": "",
      "responsavel_destino_nome": "Funil de Atendimento",
      "motivo_delegacao": "responsavel_nao_identificado",
      "nota_funcionario": "/Não foi identificado no Pipedrive um card para este cliente. Atendimento direcionado ao funil de Atendimento."
    }
  ]
}
```

Sem nenhum imóvel, ou se a consulta ao Pipedrive falhar, `imoveis` retorna
vazio e o fallback também aparece no objeto `chatapp`.

## Regra de Triagem Necessária

- `nao`: existe pelo menos um deal permitido no pipeline 16, ou no pipeline 6
  com Forma de Pagamento 34;
- `sim`: nenhum dos imóveis encontrados atende à regra acima.

Por padrão, somente deals `open` contam para essa regra. Os status podem ser
configurados em `ALLOWED_STATUSES_ANALISE_CREDITO`,
`ALLOWED_STATUSES_POS_ARREMATACAO` e `ALLOWED_STATUSES_CHATAPP_FUNIS`.

O proxy é somente leitura. Os campos `preservar_atribuido_ao_encerrar` e
`reconsultar_ao_reabrir` indicam o comportamento que deve ser configurado na
automação do ChatApp.
