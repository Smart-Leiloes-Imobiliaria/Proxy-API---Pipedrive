// Function Vercel para /api/chatapp/verificar-triagem.
//
// NOTA DE ROTEAMENTO: hoje o projeto encaminha TODO trafego para api/proxy.mjs
// (catch-all de nivel de projeto). Por isso a rota e efetivamente servida pelo
// proxy, que reconhece este path e delega para lib/chatapp-triagem.js. Este
// arquivo existe como entrada direta (caso o catch-all seja removido) e reusa
// exatamente a mesma logica isolada, fornecendo um searchDeals via proxy.

import proxy from "../../lib/pipedrive-live-proxy.js";
import triagem from "../../lib/chatapp-triagem.js";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const headers = Object.fromEntries(request.headers.entries());

    const result = await triagem.handleVerificarTriagem(
      { query, headers },
      (term) => searchDealsViaProxy(term)
    );

    return new Response(JSON.stringify(result.payload), {
      status: result.status || 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
};

// Busca deals chamando o proxy in-process em /api/v2/deals/search.
async function searchDealsViaProxy(term) {
  const token = tokenProxyInterno();
  if (!token) throw new Error("PIPEDRIVE_PROXY_API_TOKEN nao configurado para consulta interna.");

  const params = new URLSearchParams({
    path: "/api/v2/deals/search",
    term: term,
    exact_match: "true",
    fields: "custom_fields,title",
    api_token: token
  });

  const res = await proxy.handleProxyRequest({
    method: "GET",
    url: "http://internal/api/proxy?" + params.toString(),
    headers: {}
  });

  if (!res || Number(res.status) >= 400) {
    throw new Error("Falha na consulta ao proxy (status " + (res && res.status) + ").");
  }

  let json;
  try {
    json = JSON.parse(res.body);
  } catch (_) {
    throw new Error("Resposta invalida do proxy.");
  }

  const items = json && json.data && Array.isArray(json.data.items) ? json.data.items : [];
  return items.map((it) => (it && it.deal ? it.deal : null)).filter(Boolean);
}

function tokenProxyInterno() {
  const raw = String(process.env.PIPEDRIVE_PROXY_API_TOKEN || "");
  return raw.split(",").map((t) => t.trim()).filter(Boolean)[0] || "";
}
