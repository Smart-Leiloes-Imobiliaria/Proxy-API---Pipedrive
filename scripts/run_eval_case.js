const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const txt = fs.readFileSync(file, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[m[1]] = val;
  }
}

loadEnv(path.resolve(process.cwd(), '.env'));

const evalModule = require('../lib/chatapp-evaluation.js');

const body = {
  "chat_id": "553195611124",
  "license_id": "76040",
  "messenger_type": "caWhatsApp",
  "started_at": "2026-08-25T14:01:00.000Z",
  "closed_at": "2026-08-25T14:13:00.000Z",
  "source": "helper_close"
};

// build messages as described by user
const msgs = [];
function addIn(text, iso) { msgs.push({ side: 'in', text, created_at: iso, fromUser: { name: '(NÃO ATENDER) Davi Vieira | Sistemas' } }); }
function addOut(text, iso) { msgs.push({ side: 'out', text, created_at: iso, fromUser: { name: 'Smart Caixa' } }); }

addIn('ola, eu gostaria de saber se minha analise de credito foi finalizada', '2026-08-25T14:02:00.000Z');
addIn('ja esta pronta?', '2026-08-25T14:02:00.000Z');
addOut('Boa tarde, sr. Davi Vieira! Como o senhor está? Sua análise de crédito está em verificação, precisamos esperar o serviço de validação para concluir se ela foi aprovada ou não.', '2026-08-25T14:03:00.000Z');
addIn('Ah sim, entendi... sabe me dizer até que horas a resposta da caixa vem?', '2026-08-25T14:03:00.000Z');
addOut('Acreditamos que em até 1h, Davi. Uma vez que já preenchemos o formulário SIOPI.', '2026-08-25T14:04:00.000Z');
addIn('Beleza, fico no aguardo quanto a isso então', '2026-08-25T14:04:00.000Z');
addOut('Ótimo! Ajudo o senhor em mais alguma coisa?', '2026-08-25T14:04:00.000Z');
addIn('sim, gostaria de saber também se posso arrematar dois imóveis com financiamento simultaneamente, é que apareceu uma mega proposta aqui!', '2026-08-25T14:05:00.000Z');
addOut('Não, senhor Davi. Segundo o edital da própria CAIXA, um processo de arrematação com financiamento, ou seja, a confecção do contrato, verificação da análise de crédito e assinatura da minuta. Só pode ser iniciado um novo processo uma vez que um dos contratos desses dois imóveis arrematados for concluído e dado baixa pelo gerente CAIXA que assinar.', '2026-08-25T14:11:00.000Z');
addIn('Nossa, ainda bem que você me avisou antes! Tinha dado o lance no imóvel aqui e deram um lance maior... aí estava prestes a dar um lance final.', '2026-08-25T14:12:00.000Z');
addOut('Que bom que pude te ajudar quanto a isso, sr. Davi!! Gostaria de orientação em mais alguma etapa?', '2026-08-25T14:12:00.000Z');
addIn('Não! Por ora apenas isso! Obrigado mais uma vez!', '2026-08-25T14:12:00.000Z');
addOut('De nada, senhor! Vou finalizar o atendimento por ora! Uma excelente tarde!', '2026-08-25T14:13:00.000Z');
addOut('/fechar', '2026-08-25T14:13:00.000Z');
addOut('/Comando de fechamento recebido', '2026-08-25T14:13:00.000Z');
addOut('Atendimento Encerrado\nQuando precisar novamente basta nos acionar! \n\nFavor aguardar ao menos 1 MINUTO antes de enviar uma nova mensagem, e responder o assistente virtual', '2026-08-25T14:13:00.000Z');

// create fake services
const services = () => ({
  getChat: async () => ({ id: body.chat_id, name: 'Davi Vieira', responsible: { id: null } }),
  getEmployee: async (id) => ({ id, fullName: 'Funcionario Teste' }),
  listMessages: async () => msgs,
  listRecords: async () => [],
  evaluate: async (input) => ({ avaliavel: true, nota: 5, justificativa: 'OK' }),
  appendRecords: async () => null,
  appendRecord: async () => null
});

(async () => {
  const result = await evalModule.handleEvaluation({ method: 'POST', headers: { authorization: 'Bearer ' + process.env.CHATAPP_INTERNAL_TOKEN }, body }, services);
  console.log('STATUS', result.status);
  console.log('PAYLOAD', JSON.stringify(result.payload, null, 2));
})();
