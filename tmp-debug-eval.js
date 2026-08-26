// Script de debug para simular uma chamada de avaliação com logs detalhados
const evaluation = require('./lib/chatapp-evaluation.js');
process.env.DEBUG_CHATAPP_EVAL = '1';
process.env.CHATAPP_INTERNAL_TOKEN = 'debug-token';

const payload = {
  chat_id: '553195611124',
  license_id: '76040',
  messenger_type: 'caWhatsApp',
  started_at: '2026-08-25T14:01:00.000Z',
  closed_at: '2026-08-25T14:13:00.000Z',
  source: 'helper_close'
};

const messageSample = {
  id: '14ac57ce-9e09-4f8b-9820-9c3b38dab640',
  internalId: '14ac57ce-9e09-4f8b-9820-9c3b38dab640',
  fromApi: true,
  fromMe: true,
  side: 'out',
  time: 1787683701,
  type: 'text',
  subtype: 'command',
  message: { text: '/Comando de fechamento recebido', caption: '' },
  fromUser: { id: null, username: null, name: 'CCA Smart - API Oficial' },
  fromApp: { id: 'msbot', sender: 'system' },
  created: { id: 66345 }
};

(async function(){
  // Dependencies stub (minimal) to avoid external calls
  const deps = () => ({
    getChat: async () => ({ data: { id: payload.chat_id, name: 'Cliente Teste', responsible: null, status: 'closed' } }),
    getEmployee: async () => ({ data: { fullName: 'Funcionario Teste' } }),
    listMessages: async () => [messageSample],
    evaluate: async () => ({ avaliavel: true, nota: 4, justificativa: 'Teste ok' }),
    hasRecord: async () => false,
    hasEvaluationRecord: async () => false,
    appendRecord: async (r) => { console.log('appendRecord called', r); }
  });

  const req = { method: 'POST', headers: { authorization: 'Bearer debug-token' }, body: JSON.stringify(payload) };
  const result = await evaluation.handleEvaluation(req, deps);
  console.log('RESULT:', JSON.stringify(result, null, 2));
})();
