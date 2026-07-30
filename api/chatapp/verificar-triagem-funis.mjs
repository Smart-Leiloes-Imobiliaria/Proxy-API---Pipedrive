// Function Vercel para /api/chatapp/verificar-triagem-funis.
//
// A logica real fica no proxy porque o projeto pode encaminhar todo o trafego
// para api/proxy.mjs. Este wrapper mantem a mesma rota disponivel caso o
// roteamento por arquivo seja usado diretamente.

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
