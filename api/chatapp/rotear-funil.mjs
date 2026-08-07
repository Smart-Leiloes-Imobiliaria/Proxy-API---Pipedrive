// Function Vercel para /api/chatapp/rotear-funil.
//
// Rota NOVA (roteamento persistente por funil de processo), criada para nao
// alterar o comportamento das rotas ja existentes (/verificar-triagem,
// /verificar-triagem-direcionamento, /verificar-triagem-funis).
//
// NOTA DE ROTEAMENTO: o projeto encaminha TODO trafego para api/proxy.mjs
// (catch-all de nivel de projeto), entao na pratica esta rota e servida pelo
// proxy, que reconhece o path e delega para lib/chatapp-rotear-funil.js. Este
// arquivo existe como entrada direta (caso o catch-all seja removido no
// futuro) e apenas ENCAMINHA para o mesmo handler do proxy, sem duplicar
// logica.

// teste: commit de validacao do deploy automatico apos reconexao do Git na Vercel
import proxy from "../../lib/pipedrive-live-proxy.js";

export default {
  async fetch(request) {
    const res = await proxy.handleProxyRequest({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries())
    });
    return new Response(res.body, { status: res.status, headers: res.headers });
  }
};
