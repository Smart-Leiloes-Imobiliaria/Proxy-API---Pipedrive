// Function Vercel para /api/chatapp/verificar-triagem.
//
// NOTA DE ROTEAMENTO: hoje o projeto encaminha TODO trafego para api/proxy.mjs
// (catch-all de nivel de projeto), entao na pratica a rota e servida pelo proxy,
// que reconhece este path e delega para lib/chatapp-triagem.js.
//
// Este arquivo existe como entrada direta (caso o catch-all seja removido). Para
// evitar duplicar logica, apenas ENCAMINHA ao mesmo handler do proxy
// (proxy.handleProxyRequest), que ja trata este path de ponta a ponta.

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
