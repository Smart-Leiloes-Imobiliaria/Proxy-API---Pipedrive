import proxy from "../../lib/pipedrive-live-proxy.js";

export default {
  async fetch(request) {
    const res = await proxy.handleProxyRequest({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body: request.method === "POST" ? await request.text() : ""
    });
    return new Response(res.body, { status: res.status, headers: res.headers });
  }
};
