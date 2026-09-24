"use strict";

const MAX_BODY_BYTES = 64 * 1024;

function parseBitrixRequestBody(body) {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
  const raw = String(body == null ? "" : body);
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw error_("payload_too_large", 413);
  if (!raw.trim()) return {};
  if (/^[\[{]/.test(raw.trim())) {
    try { return JSON.parse(raw); } catch (_) { throw error_("invalid_json", 400); }
  }
  const parsed = {};
  for (const [key, value] of new URLSearchParams(raw).entries()) assign_(parsed, path_(key), value);
  return parsed;
}

function requestSizeAllowed(body) {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    return Buffer.byteLength(JSON.stringify(body), "utf8") <= MAX_BODY_BYTES;
  }
  return Buffer.byteLength(String(body == null ? "" : body), "utf8") <= MAX_BODY_BYTES;
}

function path_(key) {
  const parts = [];
  String(key || "").replace(/(^[^\[]+)|\[([^\]]*)\]/g, (_, first, nested) => {
    parts.push(first != null ? first : nested);
    return "";
  });
  return parts.filter((part) => part !== "");
}

function assign_(root, parts, value) {
  if (!parts.length) return;
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  const finalKey = parts[parts.length - 1];
  if (Object.prototype.hasOwnProperty.call(cursor, finalKey)) {
    cursor[finalKey] = Array.isArray(cursor[finalKey]) ? cursor[finalKey].concat(value) : [cursor[finalKey], value];
  } else {
    cursor[finalKey] = value;
  }
}

function error_(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = { MAX_BODY_BYTES, parseBitrixRequestBody, requestSizeAllowed };
