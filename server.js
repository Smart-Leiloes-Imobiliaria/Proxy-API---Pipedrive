"use strict";

const http = require("http");
const {
  handleNodeRequest,
  sanitizeUrlForLog
} = require("./lib/pipedrive-live-proxy");

const PORT = Number(process.env.PORT || 3001);
const HOST = String(process.env.HOST || "0.0.0.0");

function assertRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error("Missing env: " + name);
  }
  return value;
}

function createServer() {
  return http.createServer(async (req, res) => {
    const startedAt = Date.now();

    try {
      await handleNodeRequest(req, res);
      console.log(
        new Date().toISOString() +
        " " +
        (req.method || "GET") +
        " " +
        sanitizeUrlForLog(req.url) +
        " in " +
        (Date.now() - startedAt) +
        "ms"
      );
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        });
      }
      res.end(JSON.stringify({
        success: false,
        error: String((error && error.message) || error),
        error_info: "node_runtime_error",
        data: null,
        additional_data: null
      }));

      console.error(
        new Date().toISOString() +
        " " +
        (req.method || "GET") +
        " " +
        sanitizeUrlForLog(req.url) +
        " -> 500 in " +
        (Date.now() - startedAt) +
        "ms"
      );
      console.error(error);
    }
  });
}

function main(server) {
  assertRequiredEnv("PIPEDRIVE_API_TOKEN");
  assertRequiredEnv("PIPEDRIVE_PROXY_API_TOKEN");

  server.listen(PORT, HOST, () => {
    console.log("Live proxy listening on http://" + HOST + ":" + PORT);
    console.log("Health: http://127.0.0.1:" + PORT + "/health");
    console.log("Path mode: http://127.0.0.1:" + PORT + "/?path=/api/v2/deals/search&api_token=TOKEN");
  });
}

const server = createServer();

if (require.main === module) {
  main(server);
}

module.exports = server;
module.exports.createServer = createServer;
