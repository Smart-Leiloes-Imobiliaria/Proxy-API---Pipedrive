// Function Vercel para /api/chatapp/verificar-triagem-direcionamento.
//
// O projeto pode enviar todo trafego para api/proxy.mjs via catch-all externo.
// Por isso a logica real fica no proxy, que reconhece este path antes da auth
// generica. Este arquivo existe como entrada direta se o roteamento por arquivo
// estiver habilitado.

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
