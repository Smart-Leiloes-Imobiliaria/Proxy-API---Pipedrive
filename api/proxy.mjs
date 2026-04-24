import proxy from "../lib/pipedrive-live-proxy.js";

export default {
  async fetch(request) {
    return proxy.handleWebRequest(request);
  }
};
