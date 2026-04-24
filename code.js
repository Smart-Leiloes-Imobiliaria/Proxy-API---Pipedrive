const CONFIG = {
  domain: "smartleiloes",
  tokenKey: "PIPEDRIVE_API_TOKEN",
  proxyTokenKey: "PIPEDRIVE_PROXY_API_TOKEN",
  dataSheetName: "Pipedrive - Deals (ALL)",
  syncSheetName: "Pipedrive - Sync",
  headerRow: 1,
  pageLimit: 500,
  safetyMinutes: 10,
  timeBudgetMs: 5.6 * 60 * 1000,
  statuses: "open,won,lost",
  includeFields: [
    "next_activity_id",
    "last_activity_id",
    "first_won_time",
    "products_count",
    "files_count",
    "notes_count",
    "followers_count",
    "email_messages_count",
    "activities_count",
    "done_activities_count",
    "undone_activities_count",
    "participants_count",
    "last_incoming_mail_time",
    "last_outgoing_mail_time"
  ].join(","),
  writeChunkRows: 100,
  upsertMaxCells: 35000,
  lockTryMs: 30000,
  triggerHours: 2,
  rawDealHeader: "__pd_api_raw_deal_json",
  rawProductsHeader: "__pd_api_raw_products_json",
  apiDefaultLimit: 100,
  apiMaxLimit: 500,
  apiDirectLookupMaxIds: 50,
  apiDetailCacheTtlSeconds: 300,
  apiRowIndexCacheTtlSeconds: 1800,
  apiSearchCacheTtlSeconds: 300,
  apiReadonlyUpstreamCacheTtlSeconds: 300
};

const DEAL_SHEET_PROPERTY_CODE_HEADERS = [
  "Negócio - Número do Imóvel",
  "Negócio - Numero do Imovel",
  "Negócio - Código do Imóvel",
  "Negócio - Codigo do Imovel",
  "Negócio - Código do imóvel",
  "Negócio - Codigo do imovel"
];

const DEAL_SHEET_STANDARD_HEADERS = new Set([
  "Negócio - ID",
  "Negócio - Título",
  "Negócio - Status",
  "Negócio - Valor",
  "Negócio - Moeda de Valor",
  "Negócio - Probabilidade",
  "Negócio - Visível para",
  "Negócio - Organização (id)",
  "Negócio - Organização",
  "Negócio - Pessoa de contato (id)",
  "Negócio - Pessoa de contato",
  "Negócio - Proprietário (id)",
  "Negócio - Proprietário",
  "Negócio - Criado por (id)",
  "Negócio - Criado por",
  "Negócio - Funil (id)",
  "Negócio - Funil",
  "Negócio - Etapa (id)",
  "Negócio - Etapa",
  "Negócio - Negócio criado em",
  "Negócio - Atualizado em",
  "Negócio - Última alteração de etapa",
  "Negócio - Data de fechamento esperada",
  "Negócio - Ganho em",
  "Negócio - Data de perda",
  "Negócio - Negócio fechado em",
  "Negócio - Motivo da perda",
  "Negócio - Total de atividades",
  "Negócio - Atividades concluídas",
  "Negócio - Atividades para fazer",
  "Negócio - Número de mensagens de e-mail",
  "Negócio - Último e-mail recebido",
  "Negócio - Último e-mail enviado",
  "Negócio - Quantidade de produtos",
  "Negócio - Nome do produto",
  "Negócio - Quantidade de itens (produtos)",
  "Negócio - Valor total (produtos)",
  CONFIG.rawDealHeader,
  CONFIG.rawProductsHeader
]);

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Pipedrive")
    .addItem("Definir token", "setPipedriveToken")
    .addItem("Definir token da proxy API", "setPipedriveProxyToken")
    .addItem("Sync agora", "syncAllDealsAllFields")
    .addSeparator()
    .addItem("Instalar gatilho", "installTriggerEveryNHours")
    .addItem("Remover gatilhos", "removePipedriveTriggers")
    .addSeparator()
    .addItem("Resetar (do zero)", "resetFromZero")
    .addItem("Atualizar totais (estimativa)", "refreshEstimatedTotals")
    .addToUi();
}

function setPipedriveToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt("Token do Pipedrive", "Cole seu API token aqui:", ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const token = (res.getResponseText() || "").trim();
  if (!token) throw new Error("Token vazio.");
  PropertiesService.getScriptProperties().setProperty(CONFIG.tokenKey, token);
  ui.alert("Token salvo.");
}

function setPipedriveProxyToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    "Token da proxy API",
    "Cole o token que a Zendesk usará na proxy (ele substitui o token real do Pipedrive):",
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const token = (res.getResponseText() || "").trim();
  if (!token) throw new Error("Token vazio.");
  PropertiesService.getScriptProperties().setProperty(CONFIG.proxyTokenKey, token);
  ui.alert("Token da proxy salvo.");
}

function installTriggerEveryNHours() {
  removePipedriveTriggers();
  ScriptApp.newTrigger("syncAllDealsAllFields").timeBased().everyHours(CONFIG.triggerHours).create();
}

function removePipedriveTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction && t.getHandlerFunction() === "syncAllDealsAllFields") {
      ScriptApp.deleteTrigger(t);
    }
  }
}

function resetFromZero() {
  const ss = SpreadsheetApp.getActive();
  const data = ensureSheet_(ss, CONFIG.dataSheetName);
  const sync = ensureSyncSheet_(ss);

  data.clearContents();
  if (data.getFrozenRows() > 0) data.setFrozenRows(0);

  const patch = {
    mode: "BACKFILL",
    cursor: "",
    backfill_max_update: "",
    last_sync: "",
    include_fields_disabled: "",
    estimated_total_open: "",
    estimated_total_won: "",
    estimated_total_lost: "",
    estimated_total_all: "",
    estimated_total_at: "",
    estimated_total_cells: "",
    sheet_columns: "",
    rows_in_sheet: "0",
    progress_pct: "",
    progress_remaining_est: "",
    last_run_started: "",
    last_run_ended: "",
    last_run_processed: "0",
    last_run_inserted: "0",
    last_run_updated: "0",
    last_run_skipped: "0",
    last_error: ""
  };
  writeState_(sync, patch);
}

function refreshEstimatedTotals() {
  const ss = SpreadsheetApp.getActive();
  const sync = ensureSyncSheet_(ss);
  const totals = estimateTotals_();
  writeState_(sync, {
    estimated_total_open: String(totals.open || ""),
    estimated_total_won: String(totals.won || ""),
    estimated_total_lost: String(totals.lost || ""),
    estimated_total_all: String(totals.all || ""),
    estimated_total_at: new Date().toISOString()
  });
}

function syncAllDealsAllFields() {
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(CONFIG.lockTryMs);
  if (!got) return;

  const ss = SpreadsheetApp.getActive();
  const sync = ensureSyncSheet_(ss);
  const startedAt = new Date().toISOString();

  try {
    const token = PropertiesService.getScriptProperties().getProperty(CONFIG.tokenKey);
    if (!token) throw new Error("Defina o token no menu Pipedrive → Definir token.");

    const dataSheet = ensureSheet_(ss, CONFIG.dataSheetName);
    const deadline = Date.now() + CONFIG.timeBudgetMs - 15000;

    const state = readState_(sync);
    const mode = (state.mode || (state.last_sync ? "DELTA" : "BACKFILL")).toUpperCase();
    const cursorStart = state.cursor ? String(state.cursor) : "";
    const lastSyncIso = state.last_sync ? String(state.last_sync) : "";

    const updatedSince =
      mode === "DELTA" && lastSyncIso ? isoMinusMinutes_(lastSyncIso, CONFIG.safetyMinutes) : null;

    if (!state.estimated_total_all) {
      const totals = estimateTotals_();
      writeState_(sync, {
        estimated_total_open: String(totals.open || ""),
        estimated_total_won: String(totals.won || ""),
        estimated_total_lost: String(totals.lost || ""),
        estimated_total_all: String(totals.all || ""),
        estimated_total_at: new Date().toISOString()
      });
    }

    writeState_(sync, {
      mode: mode,
      last_run_started: startedAt,
      last_error: ""
    });

    const ctx = {
      includeDisabled: String(state.include_fields_disabled || "").trim() === "1"
    };

    const lookups = buildLookups_();
    const schema = buildSchema_(lookups.dealFields);

    const existingHeaders = readHeaders_(dataSheet);
    const desiredHeaders = schema.headers.slice();
    const finalHeaders = existingHeaders.length ? unionHeaders_(existingHeaders, desiredHeaders) : desiredHeaders;
    writeHeadersIfNeeded_(dataSheet, finalHeaders);
    hideTechnicalColumns_(dataSheet, finalHeaders);

    const idCol = findCol_(finalHeaders, "Negócio - ID");
    if (!idCol) throw new Error("Header 'Negócio - ID' não encontrado.");

    const idToRow = buildIdToRowMap_(dataSheet, idCol);

    const estAll = Number(readState_(sync).estimated_total_all || "");
    if (isFinite(estAll) && estAll > 0) {
      const estCells = (estAll + 1) * finalHeaders.length;
      writeState_(sync, {
        estimated_total_cells: String(estCells),
        sheet_columns: String(finalHeaders.length)
      });
      if (estCells > 9950000) {
        throw new Error(
          "Estimativa de células acima do limite do Google Sheets. " +
            "Reduza colunas (campos) ou divida em abas/planilhas. " +
            "estimated_total_cells=" + estCells + " cols=" + finalHeaders.length + " rows_est=" + estAll
        );
      }
    } else {
      writeState_(sync, {
        sheet_columns: String(finalHeaders.length)
      });
    }

    let cursor = cursorStart || null;
    let maxUpdate = state.backfill_max_update ? String(state.backfill_max_update) : "";
    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    while (true) {
      if (Date.now() > deadline) {
        const rowsNow = idToRow.size;
        const prog = computeProgress_(sync, rowsNow);
        writeState_(sync, {
          mode: mode,
          cursor: cursor || "",
          backfill_max_update: maxUpdate || "",
          last_run_processed: String(processed),
          last_run_inserted: String(inserted),
          last_run_updated: String(updated),
          last_run_skipped: String(skipped),
          rows_in_sheet: String(rowsNow),
          progress_pct: prog.pct,
          progress_remaining_est: prog.rem,
          last_run_ended: new Date().toISOString()
        });
        return;
      }

      const page = fetchDealsPage_(cursor, updatedSince, sync, ctx);
      const deals = (page && page.data) || [];
      cursor = getNextCursor_(page);

      if (!deals.length) break;

      const dealIds = [];
      const orgIds = [];
      const personIds = [];

      for (const d of deals) {
        if (!d || d.id == null) continue;
        if (d.is_deleted) {
          skipped++;
          continue;
        }
        if (d.is_archived || d.archived) {
          skipped++;
          continue;
        }
        dealIds.push(Number(d.id));
        if (d.org_id != null) orgIds.push(Number(d.org_id));
        if (d.person_id != null) personIds.push(Number(d.person_id));
        const ut = d.update_time ? String(d.update_time) : "";
        if (ut && ut > maxUpdate) maxUpdate = ut;
      }

      const orgMap = orgIds.length ? fetchEntitiesByIds_("organizations", orgIds) : {};
      const personMap = personIds.length ? fetchEntitiesByIds_("persons", personIds) : {};
      const productsAgg = dealIds.length ? fetchProductsAggMap_(dealIds) : {};

      const upserts = [];
      const insertsRows = [];

      for (const d of deals) {
        if (!d || d.id == null) continue;
        if (d.is_deleted) continue;
        if (d.is_archived || d.archived) continue;

        processed++;

        const rowValues = finalHeaders.map(h => {
          const spec = schema.specByHeader[String(h || "")];
          if (!spec) return "";
          return computeCell_(spec, d, lookups, orgMap, personMap, productsAgg);
        });

        const dealIdStr = String(d.id);
        const existingRow = idToRow.get(dealIdStr);

        if (existingRow) {
          upserts.push({ row: existingRow, values: rowValues });
          updated++;
        } else {
          insertsRows.push(rowValues);
          inserted++;
        }

        if (Date.now() > deadline) break;
      }

      applyUpserts_(dataSheet, upserts, CONFIG.upsertMaxCells);
      appendRowsChunked_(dataSheet, insertsRows, finalHeaders.length, idToRow, idCol, CONFIG.writeChunkRows);

      if (!cursor) break;
    }

    const rowsNow = idToRow.size;
    const prog = computeProgress_(sync, rowsNow);

    if (mode === "BACKFILL") {
      const finalLastSync = maxUpdate ? normalizePipedriveDateTime_(maxUpdate) : nowPipedriveDateTime_();
      writeState_(sync, {
        mode: "DELTA",
        last_sync: finalLastSync,
        cursor: "",
        backfill_max_update: "",
        last_run_processed: String(processed),
        last_run_inserted: String(inserted),
        last_run_updated: String(updated),
        last_run_skipped: String(skipped),
        rows_in_sheet: String(rowsNow),
        progress_pct: prog.pct,
        progress_remaining_est: prog.rem,
        last_run_ended: new Date().toISOString()
      });
    } else {
      if (maxUpdate) {
        writeState_(sync, { last_sync: normalizePipedriveDateTime_(maxUpdate) });
      } else if (!lastSyncIso) {
        writeState_(sync, { last_sync: nowPipedriveDateTime_() });
      }
      writeState_(sync, {
        mode: "DELTA",
        cursor: "",
        backfill_max_update: "",
        last_run_processed: String(processed),
        last_run_inserted: String(inserted),
        last_run_updated: String(updated),
        last_run_skipped: String(skipped),
        rows_in_sheet: String(rowsNow),
        progress_pct: prog.pct,
        progress_remaining_est: prog.rem,
        last_run_ended: new Date().toISOString()
      });
    }
  } catch (e) {
    try {
      writeState_(sync, {
        last_error: String((e && e.message) || e),
        last_run_ended: new Date().toISOString()
      });
    } catch (_) {}
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function computeProgress_(syncSheet, rowsInSheet) {
  const st = readState_(syncSheet);
  const est = Number(st.estimated_total_all || "");
  if (!isFinite(est) || est <= 0) return { pct: "", rem: "" };
  const pct = Math.max(0, Math.min(100, (rowsInSheet / est) * 100));
  const rem = Math.max(0, Math.round(est - rowsInSheet));
  return { pct: pct.toFixed(2), rem: String(rem) };
}

function ensureSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  return sh ? sh : ss.insertSheet(name);
}

function ensureSyncSheet_(ss) {
  const sh = ss.getSheetByName(CONFIG.syncSheetName) || ss.insertSheet(CONFIG.syncSheetName);
  const keys = [
    "mode",
    "cursor",
    "backfill_max_update",
    "last_sync",
    "include_fields_disabled",
    "estimated_total_open",
    "estimated_total_won",
    "estimated_total_lost",
    "estimated_total_all",
    "estimated_total_at",
    "estimated_total_cells",
    "sheet_columns",
    "rows_in_sheet",
    "progress_pct",
    "progress_remaining_est",
    "last_run_started",
    "last_run_ended",
    "last_run_processed",
    "last_run_inserted",
    "last_run_updated",
    "last_run_skipped",
    "last_error"
  ];

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 2).setValues([["key", "value"]]);
    sh.getRange(2, 1, keys.length, 1).setValues(keys.map(k => [k]));
    sh.getRange(2, 2, keys.length, 1).setValues(keys.map(() => [""]));
    sh.setFrozenRows(1);
    return sh;
  }

  const existing = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  const have = new Set();
  for (let i = 1; i < existing.length; i++) {
    const k = String(existing[i][0] || "").trim();
    if (k) have.add(k);
  }
  const missing = keys.filter(k => !have.has(k));
  if (missing.length) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, missing.length, 1).setValues(missing.map(k => [k]));
    sh.getRange(start, 2, missing.length, 1).setValues(missing.map(() => [""]));
  }
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  return sh;
}

function readState_(sync) {
  const lastRow = sync.getLastRow();
  if (lastRow < 2) return {};
  const values = sync.getRange(2, 1, lastRow - 1, 2).getValues();
  const out = {};
  for (const r of values) {
    const k = String(r[0] || "").trim();
    if (!k) continue;
    out[k] = r[1] == null ? "" : String(r[1]);
  }
  return out;
}

function writeState_(sync, patch) {
  const lastRow = sync.getLastRow();
  const values = sync.getRange(2, 1, Math.max(1, lastRow - 1), 2).getValues();
  const rowByKey = {};
  for (let i = 0; i < values.length; i++) {
    const k = String(values[i][0] || "").trim();
    if (!k) continue;
    rowByKey[k] = i + 2;
  }
  const updates = [];
  for (const k of Object.keys(patch || {})) {
    const row = rowByKey[k];
    if (!row) continue;
    updates.push({ row, value: patch[k] });
  }
  updates.sort((a, b) => a.row - b.row);

  let i = 0;
  while (i < updates.length) {
    let j = i;
    while (j + 1 < updates.length && updates[j + 1].row === updates[j].row + 1) j++;
    const block = updates.slice(i, j + 1);
    const startRow = block[0].row;
    const vals = block.map(x => [x.value]);
    sync.getRange(startRow, 2, vals.length, 1).setValues(vals);
    i = j + 1;
  }
}

function nowPipedriveDateTime_() {
  return Utilities.formatDate(new Date(), "GMT", "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function normalizePipedriveDateTime_(s) {
  const t = new Date(s).getTime();
  if (!isFinite(t)) return String(s || "");
  return Utilities.formatDate(new Date(t), "GMT", "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function isoMinusMinutes_(iso, mins) {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return String(iso || "");
  const d = new Date(t - (Number(mins) || 0) * 60 * 1000);
  return Utilities.formatDate(d, "GMT", "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function readHeaders_(sh) {
  const lastCol = sh.getLastColumn();
  if (!lastCol) return [];
  const row = sh.getRange(CONFIG.headerRow, 1, 1, lastCol).getValues()[0];
  const headers = row.map(x => String(x || "").trim());
  return headers.some(h => h) ? headers : [];
}

function writeHeadersIfNeeded_(sh, headers) {
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  const existing = readHeaders_(sh);
  const same = existing.length === headers.length && existing.every((h, i) => String(h) === String(headers[i]));
  if (same) return;
  sh.getRange(CONFIG.headerRow, 1, 1, headers.length).setValues([headers]);
  if (sh.getFrozenRows() < CONFIG.headerRow) sh.setFrozenRows(CONFIG.headerRow);
}

function hideTechnicalColumns_(sh, headers) {
  const techHeaders = [CONFIG.rawDealHeader, CONFIG.rawProductsHeader];
  for (const name of techHeaders) {
    const col = findCol_(headers || [], name);
    if (col) sh.hideColumns(col);
  }
}

function unionHeaders_(existing, desired) {
  const seen = new Set();
  const out = [];
  const add = (h) => {
    const k = String(h || "").trim();
    if (!k) return;
    const n = k.toLowerCase();
    if (seen.has(n)) return;
    seen.add(n);
    out.push(k);
  };
  (existing || []).forEach(add);
  (desired || []).forEach(add);
  return out;
}

function findCol_(headers, name) {
  const target = String(name || "").trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim().toLowerCase() === target) return i + 1;
  }
  return 0;
}

function findFirstCol_(headers, names) {
  for (const name of (names || [])) {
    const col = findCol_(headers, name);
    if (col) return col;
  }
  return 0;
}

function buildIdToRowMap_(sh, idCol) {
  const lastRow = sh.getLastRow();
  const map = new Map();
  if (lastRow <= CONFIG.headerRow) return map;
  const values = sh.getRange(CONFIG.headerRow + 1, idCol, lastRow - CONFIG.headerRow, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const id = values[i][0];
    if (id === null || id === undefined || id === "") continue;
    map.set(String(id), CONFIG.headerRow + 1 + i);
  }
  return map;
}

function appendRowsChunked_(sh, rows, width, idToRow, idCol, chunkSize) {
  if (!rows.length) return;
  const size = Math.max(1, Number(chunkSize) || 100);
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    appendRows_(sh, chunk, width, idToRow, idCol);
  }
}

function appendRows_(sh, rows, width, idToRow, idCol) {
  if (!rows.length) return;
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  const startRow = sh.getLastRow() + 1;
  const needRows = startRow + rows.length - 1;
  if (needRows > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  sh.getRange(startRow, 1, rows.length, width).setValues(rows);
  for (let i = 0; i < rows.length; i++) {
    const idVal = rows[i][idCol - 1];
    if (idVal !== null && idVal !== undefined && idVal !== "") idToRow.set(String(idVal), startRow + i);
  }
}

function applyUpserts_(sh, upserts, maxCells) {
  if (!upserts.length) return;
  upserts.sort((a, b) => a.row - b.row);

  const cap = Math.max(1000, Number(maxCells) || 35000);

  let i = 0;
  while (i < upserts.length) {
    let j = i;
    while (j + 1 < upserts.length && upserts[j + 1].row === upserts[j].row + 1) j++;

    const block = upserts.slice(i, j + 1);
    const startRow = block[0].row;
    const height = block.length;
    const width = block[0].values.length;

    const cells = height * width;
    if (cells <= cap) {
      if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
      sh.getRange(startRow, 1, height, width).setValues(block.map(x => x.values));
      i = j + 1;
      continue;
    }

    const maxH = Math.max(1, Math.floor(cap / Math.max(1, width)));
    let k = 0;
    while (k < block.length) {
      const slice = block.slice(k, k + maxH);
      const sr = slice[0].row;
      const h = slice.length;
      if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
      sh.getRange(sr, 1, h, width).setValues(slice.map(x => x.values));
      k += maxH;
    }
    i = j + 1;
  }
}

function buildLookups_() {
  const pipelines = getCached_("PD_PIPELINES_V2", 21600, () => {
    const out = {};
    const arr = fetchAllV2_("/pipelines", { limit: 500 });
    for (const p of arr) if (p && p.id != null) out[String(p.id)] = String(p.name || "");
    return out;
  });

  const stages = getCached_("PD_STAGES_V2", 21600, () => {
    const out = {};
    const arr = fetchAllV2_("/stages", { limit: 500 });
    for (const s of arr) if (s && s.id != null) out[String(s.id)] = String(s.name || "");
    return out;
  });

  const users = getCached_("PD_USERS_V1", 21600, () => {
    const out = {};
    const json = pipedriveGetV1_("/users", {});
    const data = (json && json.data) || [];
    for (const u of data) if (u && u.id != null) out[String(u.id)] = String(u.name || "");
    return out;
  });

  const dealFields = getDealFieldsList_();

  return { pipelines, stages, users, dealFields };
}

function getDealFieldsList_() {
  return getCached_("PD_DEAL_FIELDS_ALL_NORMALIZED_V2", 21600, () => {
    try {
      const json = pipedriveGetV1_("/dealFields", {});
      const data = (json && json.data) || [];
      if (data.length) return data.map(normalizeDealFieldDefinition_).filter(Boolean);
    } catch (e) {}

    try {
      return fetchAllV2_("/dealFields", { limit: 500 }).map(normalizeDealFieldDefinition_).filter(Boolean);
    } catch (e) {}

    return [];
  });
}

function getDealFieldMaps_() {
  return getCached_("PD_DEAL_FIELDS_MAPS_V2", 21600, () => {
    const byKey = {};
    const byName = {};
    const fields = getDealFieldsList_();
    for (const field of fields) {
      if (!field || !field.key) continue;
      const key = String(field.key || "");
      const name = String(field.name || key);
      const meta = {
        id: field.id == null ? null : field.id,
        key: key,
        name: name,
        field_type: String(field.field_type || ""),
        edit_flag: !!field.edit_flag,
        options: Array.isArray(field.options) ? field.options.slice() : [],
        options_by_id: buildFieldOptionsById_(field.options),
        options_by_label: buildFieldOptionsByLabel_(field.options)
      };
      byKey[key] = meta;
      byName[name] = meta;
    }
    return { byKey, byName };
  });
}

function buildFieldOptionsById_(options) {
  const out = {};
  const list = Array.isArray(options) ? options : [];
  for (const option of list) {
    if (!option || option.id == null) continue;
    out[String(option.id)] = option.label == null ? "" : String(option.label);
  }
  return out;
}

function buildFieldOptionsByLabel_(options) {
  const out = {};
  const list = Array.isArray(options) ? options : [];
  for (const option of list) {
    if (!option || option.label == null) continue;
    out[String(option.label)] = option.id == null ? null : option.id;
  }
  return out;
}

function normalizeDealFieldDefinition_(field) {
  if (!field) return null;
  const key = String(field.key || field.field_code || "").trim();
  if (!key) return null;

  const name = String(field.name || field.field_name || key).trim() || key;
  const options = [];
  const rawOptions = Array.isArray(field.options) ? field.options : [];
  for (const option of rawOptions) {
    if (!option) continue;
    const id = option.id != null ? option.id : option.key;
    const label = option.label != null ? option.label : option.name;
    options.push({
      id: id,
      label: label == null ? "" : String(label)
    });
  }

  return {
    id: field.id == null ? null : field.id,
    key: key,
    name: name,
    field_type: String(field.field_type || "").trim(),
    edit_flag: field.edit_flag == null ? false : !!field.edit_flag,
    options: options
  };
}

function buildSchema_(dealFields) {
  const headers = [];
  const specByHeader = {};

  const add = (h, spec) => {
    const key = String(h || "").trim();
    if (!key) return;
    const n = key.toLowerCase();
    for (const ex of headers) if (String(ex).toLowerCase() === n) return;
    headers.push(key);
    specByHeader[key] = spec;
  };

  add("Negócio - ID", { t: "std", k: "id" });
  add("Negócio - Título", { t: "std", k: "title" });
  add("Negócio - Status", { t: "std", k: "status" });
  add("Negócio - Valor", { t: "std", k: "value" });
  add("Negócio - Moeda de Valor", { t: "std", k: "currency" });
  add("Negócio - Probabilidade", { t: "std", k: "probability" });
  add("Negócio - Visível para", { t: "std", k: "visible_to" });

  add("Negócio - Organização (id)", { t: "std", k: "org_id" });
  add("Negócio - Organização", { t: "lookup_org", k: "org_id" });

  add("Negócio - Pessoa de contato (id)", { t: "std", k: "person_id" });
  add("Negócio - Pessoa de contato", { t: "lookup_person", k: "person_id" });

  add("Negócio - Proprietário (id)", { t: "std", k: "owner_id" });
  add("Negócio - Proprietário", { t: "lookup_user", k: "owner_id" });

  add("Negócio - Criado por (id)", { t: "std", k: "creator_user_id" });
  add("Negócio - Criado por", { t: "lookup_user", k: "creator_user_id" });

  add("Negócio - Funil (id)", { t: "std", k: "pipeline_id" });
  add("Negócio - Funil", { t: "lookup_pipeline", k: "pipeline_id" });

  add("Negócio - Etapa (id)", { t: "std", k: "stage_id" });
  add("Negócio - Etapa", { t: "lookup_stage", k: "stage_id" });

  add("Negócio - Negócio criado em", { t: "std", k: "add_time" });
  add("Negócio - Atualizado em", { t: "std", k: "update_time" });
  add("Negócio - Última alteração de etapa", { t: "std", k: "stage_change_time" });
  add("Negócio - Data de fechamento esperada", { t: "std", k: "expected_close_date" });
  add("Negócio - Ganho em", { t: "std", k: "won_time" });
  add("Negócio - Data de perda", { t: "std", k: "lost_time" });
  add("Negócio - Negócio fechado em", { t: "std", k: "close_time" });
  add("Negócio - Motivo da perda", { t: "std", k: "lost_reason" });

  add("Negócio - Total de atividades", { t: "std", k: "activities_count" });
  add("Negócio - Atividades concluídas", { t: "std", k: "done_activities_count" });
  add("Negócio - Atividades para fazer", { t: "std", k: "undone_activities_count" });
  add("Negócio - Número de mensagens de e-mail", { t: "std", k: "email_messages_count" });
  add("Negócio - Último e-mail recebido", { t: "std", k: "last_incoming_mail_time" });
  add("Negócio - Último e-mail enviado", { t: "std", k: "last_outgoing_mail_time" });

  add("Negócio - Quantidade de produtos", { t: "std", k: "products_count" });
  add("Negócio - Nome do produto", { t: "products", k: "names" });
  add("Negócio - Quantidade de itens (produtos)", { t: "products", k: "qty" });
  add("Negócio - Valor total (produtos)", { t: "products", k: "value" });

  const excludeKeys = new Set([
    "id","title","status","value","currency","probability","visible_to",
    "org_id","person_id","owner_id","creator_user_id","pipeline_id","stage_id",
    "add_time","update_time","stage_change_time","expected_close_date",
    "won_time","lost_time","close_time","lost_reason",
    "activities_count","done_activities_count","undone_activities_count","email_messages_count",
    "last_incoming_mail_time","last_outgoing_mail_time","products_count",
    "next_activity_id","last_activity_id","first_won_time","files_count","notes_count","followers_count","participants_count"
  ]);

  for (const f of (dealFields || [])) {
    if (!f || !f.key || !f.name) continue;
    const key = String(f.key).trim();
    const name = String(f.name).trim();
    const type = String(f.field_type || "").trim().toLowerCase();
    if (!name || !key) continue;
    if (excludeKeys.has(key)) continue;

    const opt = {};
    if (Array.isArray(f.options)) {
      for (const o of f.options) {
        if (!o || o.id == null) continue;
        opt[String(o.id)] = o.label != null ? String(o.label) : "";
      }
    }

    if (type === "monetary") {
      add(`Negócio - ${name}`, { t: "cf_money", c: key, o: opt, s: "value" });
      add(`Negócio - Moeda de ${name}`, { t: "cf_money", c: key, o: opt, s: "currency" });
      continue;
    }

    if (type === "daterange" || type === "date_range" || type === "timerange" || type === "time_range") {
      add(`Negócio - ${name} (início)`, { t: "cf_range", c: key, o: opt, s: "value" });
      add(`Negócio - ${name} (fim)`, { t: "cf_range", c: key, o: opt, s: "until" });
      continue;
    }

    if (type === "time") {
      add(`Negócio - ${name}`, { t: "cf_time", c: key, s: "value" });
      add(`Negócio - ${name} (timezone_id)`, { t: "cf_time", c: key, s: "timezone_id" });
      add(`Negócio - ${name} (timezone_name)`, { t: "cf_time", c: key, s: "timezone_name" });
      continue;
    }

    if (type === "address" || type === "postal_address") {
      add(`Negócio - ${name}`, { t: "cf_addr", c: key, s: "value" });
      add(`Negócio - ${name} - formatted_address`, { t: "cf_addr", c: key, s: "formatted_address" });
      add(`Negócio - ${name} - route`, { t: "cf_addr", c: key, s: "route" });
      add(`Negócio - ${name} - street_number`, { t: "cf_addr", c: key, s: "street_number" });
      add(`Negócio - ${name} - subpremise`, { t: "cf_addr", c: key, s: "subpremise" });
      add(`Negócio - ${name} - sublocality`, { t: "cf_addr", c: key, s: "sublocality" });
      add(`Negócio - ${name} - locality`, { t: "cf_addr", c: key, s: "locality" });
      add(`Negócio - ${name} - admin_area_level_1`, { t: "cf_addr", c: key, s: "admin_area_level_1" });
      add(`Negócio - ${name} - admin_area_level_2`, { t: "cf_addr", c: key, s: "admin_area_level_2" });
      add(`Negócio - ${name} - country`, { t: "cf_addr", c: key, s: "country" });
      add(`Negócio - ${name} - postal_code`, { t: "cf_addr", c: key, s: "postal_code" });
      add(`Negócio - ${name} - lat`, { t: "cf_addr", c: key, s: "lat" });
      add(`Negócio - ${name} - lng`, { t: "cf_addr", c: key, s: "lng" });
      continue;
    }

    add(`Negócio - ${name}`, { t: "cf", c: key, o: opt });
  }

  add(CONFIG.rawDealHeader, { t: "raw_deal" });
  add(CONFIG.rawProductsHeader, { t: "raw_products" });

  return { headers, specByHeader };
}

function computeCell_(spec, d, lookups, orgMap, personMap, productsAgg) {
  const safe = (v) => (v === undefined || v === null ? "" : v);

  if (spec.t === "std") return safe(d[spec.k]);

  if (spec.t === "lookup_org") {
    const id = d[spec.k];
    if (id == null) return "";
    return safe(orgMap[String(id)] || "");
  }

  if (spec.t === "lookup_person") {
    const id = d[spec.k];
    if (id == null) return "";
    return safe(personMap[String(id)] || "");
  }

  if (spec.t === "lookup_user") {
    const id = d[spec.k];
    if (id == null) return "";
    return safe(lookups.users[String(id)] || "");
  }

  if (spec.t === "lookup_pipeline") {
    const id = d[spec.k];
    if (id == null) return "";
    return safe(lookups.pipelines[String(id)] || "");
  }

  if (spec.t === "lookup_stage") {
    const id = d[spec.k];
    if (id == null) return "";
    return safe(lookups.stages[String(id)] || "");
  }

  if (spec.t === "products") {
    const id = d.id != null ? String(d.id) : "";
    const agg = id ? productsAgg[id] : null;
    if (!agg) return "";
    if (spec.k === "names") return safe(agg.names);
    if (spec.k === "qty") return safe(agg.qty);
    if (spec.k === "value") return safe(agg.value);
    return "";
  }

  if (spec.t === "raw_deal") {
    return stringifyForCell_(d);
  }

  if (spec.t === "raw_products") {
    const id = d.id != null ? String(d.id) : "";
    const agg = id ? productsAgg[id] : null;
    return stringifyForCell_(agg && Array.isArray(agg.items) ? agg.items : []);
  }

  const cfRoot = d && d.custom_fields ? d.custom_fields : {};
  const cf = cfRoot ? cfRoot[spec.c] : undefined;
  if (cf === undefined || cf === null) return "";

  const mapOptions = (val, optMap) => {
    if (!optMap || !Object.keys(optMap).length) return val;
    const key = String(val);
    return optMap[key] !== undefined ? optMap[key] : val;
  };

  if (spec.t === "cf") {
    if (Array.isArray(cf)) return cf.map(v => mapOptions(v, spec.o)).join(", ");
    if (typeof cf === "object") return JSON.stringify(cf);
    return mapOptions(cf, spec.o);
  }

  if (spec.t === "cf_money") {
    if (typeof cf === "object" && cf) {
      if (spec.s === "value") return safe(cf.value);
      if (spec.s === "currency") return safe(cf.currency);
      return "";
    }
    if (spec.s === "value") return safe(cf);
    if (spec.s === "currency") {
      const ckey = spec.c + "_currency";
      const cv = cfRoot ? cfRoot[ckey] : undefined;
      return safe(cv);
    }
    return "";
  }

  if (spec.t === "cf_range") {
    if (typeof cf === "object" && cf) {
      if (spec.s === "value") return safe(cf.value);
      if (spec.s === "until") return safe(cf.until);
      return "";
    }
    if (spec.s === "value") return safe(cf);
    if (spec.s === "until") {
      const ukey = spec.c + "_until";
      const uv = cfRoot ? cfRoot[ukey] : undefined;
      return safe(uv);
    }
    return "";
  }

  if (spec.t === "cf_time") {
    if (typeof cf === "object" && cf) {
      if (spec.s === "value") return safe(cf.value);
      if (spec.s === "timezone_id") return safe(cf.timezone_id);
      if (spec.s === "timezone_name") return safe(cf.timezone_name);
      return "";
    }
    return spec.s === "value" ? safe(cf) : "";
  }

  if (spec.t === "cf_addr") {
    if (typeof cf === "object" && cf) return safe(cf[spec.s]);
    return spec.s === "value" ? safe(cf) : "";
  }

  return "";
}

function fetchDealsPage_(cursor, updatedSince, syncSheet, ctx) {
  const params = {
    status: CONFIG.statuses,
    limit: CONFIG.pageLimit,
    sort_by: "update_time",
    sort_direction: "asc"
  };
  if (cursor) params.cursor = cursor;
  if (updatedSince) params.updated_since = updatedSince;
  if (!ctx.includeDisabled && CONFIG.includeFields) params.include_fields = CONFIG.includeFields;

  try {
    const json = pipedriveGetV2_("/deals", params);
    if (!ctx.includeDisabled) {
      const st = readState_(syncSheet);
      if (String(st.include_fields_disabled || "").trim() === "1") writeState_(syncSheet, { include_fields_disabled: "" });
    }
    return json;
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!ctx.includeDisabled && msg.indexOf("include_fields") !== -1) {
      ctx.includeDisabled = true;
      writeState_(syncSheet, { include_fields_disabled: "1" });
      const p2 = Object.assign({}, params);
      delete p2.include_fields;
      return pipedriveGetV2_("/deals", p2);
    }
    throw e;
  }
}

function fetchEntitiesByIds_(entity, ids) {
  const uniq = Array.from(new Set((ids || []).map(Number).filter(n => isFinite(n))));
  if (!uniq.length) return {};
  const out = {};
  const chunks = chunk_(uniq, 100);
  for (const c of chunks) {
    const json = pipedriveGetV2_(`/${entity}`, { ids: c.join(","), limit: 500 });
    const data = (json && json.data) || [];
    for (const it of data) {
      if (!it || it.id == null) continue;
      out[String(it.id)] = String(it.name || "");
    }
  }
  return out;
}

function fetchProductsAggMap_(dealIds) {
  const out = {};
  const chunks = chunk_(dealIds, 100);

  for (const c of chunks) {
    let cursor = null;
    while (true) {
      const json = pipedriveGetV2_("/deals/products", { deal_ids: c.join(","), limit: 500, cursor: cursor || undefined });
      const data = (json && json.data) || [];
      for (const it of data) {
        if (!it) continue;
        const dealId = it.deal_id != null ? String(it.deal_id) : "";
        if (!dealId) continue;
        if (!out[dealId]) out[dealId] = { namesSet: new Set(), qty: 0, value: 0, items: [] };
        const agg = out[dealId];
        const name = it.name != null ? String(it.name) : "";
        if (name) agg.namesSet.add(name);
        const q = Number(it.quantity || 0);
        const p = Number(it.item_price || 0);
        const qq = isFinite(q) ? q : 0;
        const pp = isFinite(p) ? p : 0;
        agg.qty += qq;
        agg.value += qq * pp;
        agg.items.push(it);
      }
      cursor = getNextCursor_(json);
      if (!cursor) break;
    }
  }

  const finalOut = {};
  for (const k of Object.keys(out)) {
    finalOut[k] = {
      names: Array.from(out[k].namesSet).join(", "),
      qty: out[k].qty,
      value: out[k].value
    };
  }
  return finalOut;
}

function chunk_(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function stringifyForCell_(obj) {
  if (obj === undefined || obj === null) return "";
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return "";
  }
}

function getNextCursor_(json) {
  if (!json || !json.additional_data) return null;
  const ad = json.additional_data;
  if (ad.pagination && ad.pagination.next_cursor) return ad.pagination.next_cursor;
  if (ad.next_cursor) return ad.next_cursor;
  return null;
}

function fetchAllV2_(path, params) {
  const out = [];
  let cursor = null;
  while (true) {
    const p = Object.assign({}, params || {});
    if (cursor) p.cursor = cursor;
    const json = pipedriveGetV2_(path, p);
    const data = (json && json.data) || [];
    for (const it of data) out.push(it);
    cursor = getNextCursor_(json);
    if (!cursor) break;
  }
  return out;
}

function getCached_(key, ttlSeconds, builder) {
  const cache = CacheService.getScriptCache();
  try {
    const v = cache.get(key);
    if (v) return JSON.parse(v);
  } catch (e) {}
  const obj = builder();
  try {
    const s = JSON.stringify(obj);
    if (s.length <= 90000) cache.put(key, s, ttlSeconds);
  } catch (e) {}
  return obj;
}

function getCachedOnly_(key) {
  const cache = CacheService.getScriptCache();
  try {
    const v = cache.get(key);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

function pipedriveGetV2_(path, params) {
  return fetchJsonWithRetry_(`https://${CONFIG.domain}.pipedrive.com/api/v2${path}`, params);
}

function pipedriveGetV1_(path, params) {
  return fetchJsonWithRetry_(`https://${CONFIG.domain}.pipedrive.com/api/v1${path}`, params);
}

function fetchJsonWithRetry_(baseUrl, params) {
  const token = PropertiesService.getScriptProperties().getProperty(CONFIG.tokenKey);
  if (!token) throw new Error("Token não configurado.");

  const qs = buildQuery_({ api_token: token, ...params });
  const url = `${baseUrl}?${qs}`;

  let attempt = 0;
  let lastErr = null;

  while (attempt < 6) {
    attempt++;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = resp.getResponseCode();
    const text = resp.getContentText();

    if (code >= 200 && code < 300) {
      const json = JSON.parse(text);
      if (json && json.success === false) throw new Error(text);
      return json;
    }

    const retryable = code === 429 || (code >= 500 && code <= 599);
    if (!retryable) throw new Error(`HTTP ${code}: ${text}`);

    lastErr = new Error(`HTTP ${code}: ${text}`);
    Utilities.sleep(Math.min(30000, 500 * Math.pow(2, attempt)));
  }

  throw lastErr || new Error("Falha em fetch.");
}

function buildQuery_(obj) {
  const parts = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

function estimateTotals_() {
  const out = { open: 0, won: 0, lost: 0, all: 0 };
  const statuses = ["open", "won", "lost"];
  for (const s of statuses) {
    try {
      const json = pipedriveGetV1_("/deals", { status: s, start: 0, limit: 1 });
      const pag = json && json.additional_data && json.additional_data.pagination ? json.additional_data.pagination : {};
      const t =
        pag.total_items ??
        pag.total_items_count ??
        pag.total_count ??
        pag.total ??
        pag.items_total ??
        null;
      const n = Number(t);
      if (isFinite(n)) {
        out[s] = n;
        out.all += n;
      }
    } catch (e) {}
  }
  if (!out.all) return { open: "", won: "", lost: "", all: "" };
  return out;
}

function doGet(e) {
  return handleProxyWebRequest_(e, "GET");
}

function handleProxyWebRequest_(e, defaultMethod) {
  try {
    const req = normalizeWebRequest_(e, defaultMethod);
    if (!req.path || req.path === "/") {
      return jsonOutput_({
        success: true,
        data: {
          name: "Pipedrive Proxy API",
          mode: "readonly_hybrid",
          sheet_backed_routes: [
            "/api/v2/deals",
            "/api/v2/deals/{id}",
            "/api/v2/deals/products"
          ],
          pipedrive_backed_routes: [
            "/api/v2/deals/search",
            "/api/v2/persons",
            "/api/v2/persons/{id}",
            "/api/v2/organizations",
            "/api/v2/organizations/{id}",
            "/api/v2/pipelines",
            "/api/v2/stages",
            "/v1/users",
            "/v1/dealFields"
          ],
          filters: [
            "status",
            "ids",
            "owner_id",
            "person_id",
            "org_id",
            "pipeline_id",
            "stage_id",
            "updated_since",
            "updated_until",
            "filter_id",
            "limit",
            "cursor",
            "sort_by",
            "sort_direction",
            "term",
            "fields",
            "exact_match",
            "search_by"
          ],
          auth: "Use ?api_token=SEU_TOKEN_DA_PROXY"
        },
        additional_data: null
      });
    }

    if (req.path === "/health") {
      return jsonOutput_({
        success: true,
        data: {
          status: "ok",
          now: new Date().toISOString()
        },
        additional_data: null
      });
    }

    assertProxyAuthorized_(req);

    if (req.method !== "GET") {
      return errorOutput_("Esta proxy e somente leitura e aceita apenas GET.", "readonly_only");
    }

    const sheetResponse = tryHandleSheetDealsRequest_(req);
    if (sheetResponse) return sheetResponse;
    const readonlyUpstream = tryHandleReadonlyUpstreamRoute_(req);
    if (readonlyUpstream) return readonlyUpstream;
    return errorOutput_("Rota GET não suportada pela proxy readonly.", "unsupported_route");
  } catch (e) {
    return errorOutput_(String((e && e.message) || e), "proxy_error");
  }
}

function normalizeWebRequest_(e, defaultMethod) {
  const query = Object.assign({}, (e && e.parameter) || {});
  const bodyText = e && e.postData && typeof e.postData.contents === "string" ? e.postData.contents : "";
  const contentType = e && e.postData && e.postData.type ? String(e.postData.type) : "";
  const overrideMethod = String(query._method || query.method || defaultMethod || "GET").trim().toUpperCase();
  const rawPath =
    (e && e.pathInfo ? String(e.pathInfo) : "") ||
    String(query.path || query.endpoint || "").replace(/^https?:\/\/[^/]+/i, "");
  const path = normalizeApiPath_(rawPath);

  return {
    method: overrideMethod,
    path: path,
    query: query,
    bodyText: bodyText,
    contentType: contentType
  };
}

function normalizeApiPath_(rawPath) {
  const clean = String(rawPath || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\?.*$/, "");
  return clean ? "/" + clean : "/";
}

function assertProxyAuthorized_(req) {
  const configured = String(PropertiesService.getScriptProperties().getProperty(CONFIG.proxyTokenKey) || "").trim();
  if (!configured) {
    throw new Error("Defina antes o token da proxy em Pipedrive > Definir token da proxy API.");
  }
  const incoming = String((req && req.query && req.query.api_token) || "").trim();
  if (!incoming || incoming !== configured) {
    throw new Error("Não autorizado. Use o api_token da proxy.");
  }
}

function tryHandleSheetDealsRequest_(req) {
  const path = String(req.path || "");

  if (path === "/api/v2/deals") {
    if (shouldProxyDealsListUpstream_(req.query || {})) {
      return proxyReadonlyUpstreamGet_(req);
    }
    return handleSheetDealsList_(req);
  }

  if (path === "/api/v2/deals/products") {
    return handleSheetDealsProducts_(req);
  }

  const matchDeal = path.match(/^\/api\/v2\/deals\/(\d+)$/);
  if (matchDeal) {
    return handleSheetDealDetails_(req, Number(matchDeal[1]));
  }

  return null;
}

function shouldProxyDealsListUpstream_(query) {
  const q = query || {};
  return String(q.filter_id || "").trim() !== "";
}

function tryHandleReadonlyUpstreamRoute_(req) {
  const path = String(req.path || "");
  if (path === "/api/v2/deals/search") {
    const sheetSearch = tryHandleSheetDealsSearch_(req);
    if (sheetSearch) return sheetSearch;
    return handleDealsSearch_(req);
  }
  if (!isReadonlyUpstreamPath_(path)) return null;
  return proxyReadonlyUpstreamGet_(req);
}

function isReadonlyUpstreamPath_(path) {
  const p = String(path || "");
  return (
    p === "/api/v2/deals/search" ||
    p === "/api/v2/persons" ||
    /^\/api\/v2\/persons\/\d+$/.test(p) ||
    p === "/api/v2/organizations" ||
    /^\/api\/v2\/organizations\/\d+$/.test(p) ||
    p === "/api/v2/pipelines" ||
    p === "/api/v2/stages" ||
    p === "/v1/users" ||
    p === "/v1/dealFields"
  );
}

function tryHandleSheetDealsSearch_(req) {
  if (String(req && req.path || "") !== "/api/v2/deals/search") return null;
  const ctx = getDealsSheetContext_();
  const searchSpec = getFastSheetDealsSearchSpec_((req && req.query) || {}, ctx);
  if (!searchSpec) return null;
  return handleSheetDealsSearch_(req, searchSpec, ctx);
}

function getFastSheetDealsSearchSpec_(query, ctx) {
  const q = query || {};
  const term = String(q.term || "").trim();
  if (!term) return null;
  if (!isTruthyQueryBoolean_(q.exact_match)) return null;
  if (!areFastSheetDealsSearchFieldsAllowed_(q.fields)) return null;

  const kinds = resolveFastSheetDealsSearchKinds_(term, q.search_by, ctx);
  if (!kinds.length) return null;

  return {
    term: term,
    kinds: kinds
  };
}

function areFastSheetDealsSearchFieldsAllowed_(fieldsValue) {
  const fields = String(fieldsValue || "").trim().toLowerCase();
  if (!fields) return true;
  const allow = new Set(fields.split(",").map(x => String(x || "").trim()).filter(Boolean));
  return allow.has("custom_fields") || allow.has("title");
}

function resolveFastSheetDealsSearchKinds_(term, requestedKind, ctx) {
  const mode = String(requestedKind || "auto").trim().toLowerCase();
  const activeKinds = [];
  const trimmed = String(term || "").trim();
  const digitsOnly = extractDigits_(trimmed);
  const isNumericCpf = /^\d{11}$/.test(trimmed);

  const pushKind = (kind) => {
    if (!isFastSheetDealsSearchKindAvailable_(kind, ctx)) return;
    if (activeKinds.indexOf(kind) === -1) activeKinds.push(kind);
  };

  if (mode && mode !== "auto") {
    if (normalizeDealSearchTerm_(mode, trimmed)) pushKind(mode);
    return activeKinds;
  }

  if (normalizeDealSearchTerm_("email", trimmed)) {
    pushKind("email");
    return activeKinds;
  }

  if (normalizeDealSearchTerm_("cpf", trimmed)) {
    pushKind("cpf");
    if (isNumericCpf && digitsOnly === trimmed) pushKind("property_code");
    return activeKinds;
  }

  if (normalizeDealSearchTerm_("property_code", trimmed)) {
    pushKind("property_code");
  }

  return activeKinds;
}

function isFastSheetDealsSearchKindAvailable_(kind, ctx) {
  const current = ctx || getDealsSheetContext_();
  if (kind === "property_code") return !!current.propertyCodeCol;
  if (kind === "cpf") return !!((current.cpfCols || []).length);
  if (kind === "email") return !!((current.emailCols || []).length);
  return false;
}

function isTruthyQueryBoolean_(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function handleSheetDealsList_(req) {
  const idsFilter = parseIdsFilter_(req.query.ids);
  const dataset = shouldUseDirectDealLookup_(idsFilter) ? getDealsDatasetByIds_(idsFilter) : getDealsDataset_();
  let items = dataset.items.slice();
  items = filterDealEntries_(items, req.query);
  items = sortDealEntries_(items, req.query);

  const page = paginateCollection_(items, req.query);
  const data = page.items.map(x => shapeDealForApi_(x.deal, req.query));

  return jsonOutput_({
    success: true,
    data: data,
    additional_data: {
      pagination: page.pagination
    }
  });
}

function handleSheetDealDetails_(req, id) {
  const rowEntry = getDealRowEntryById_(id);
  if (rowEntry && rowEntry.item) {
    const fieldMaps = getCachedOnly_("PD_DEAL_FIELDS_MAPS_V2");
    const deal = enrichDealWithReadableFields_(shapeDealForApi_(rowEntry.item.deal, req.query), fieldMaps, rowEntry.rowMap);
    deal.ai_summary = buildDealAiSummary_(deal, null);

    return jsonOutput_({
      success: true,
      data: deal,
      additional_data: null
    });
  }
  return errorOutput_("Negócio não encontrado na base espelhada.", "not_found");
}

function handleSheetDealsProducts_(req) {
  const idsFilter = parseIdsFilter_(req.query.deal_ids);
  const dataset = shouldUseDirectDealLookup_(idsFilter) ? getDealsDatasetByIds_(idsFilter) : getDealsDataset_();
  const items = [];

  for (const entry of dataset.items) {
    const dealId = Number(entry.deal && entry.deal.id);
    if (idsFilter && !idsFilter.has(dealId)) continue;
    const products = Array.isArray(entry.products) ? entry.products : [];
    for (const product of products) items.push(product);
  }

  const page = paginateCollection_(items, req.query);
  return jsonOutput_({
    success: true,
    data: page.items,
    additional_data: {
      pagination: page.pagination
    }
  });
}

function handleSheetDealsSearch_(req, searchSpec, ctx) {
  const matches = mergeDealRowEntryLists_(
    findDealRowEntriesByFastSearch_(searchSpec, ctx),
    findDealRowEntriesByPersonIdentitySearch_(searchSpec, ctx)
  );
  if (!matches.length) return null;
  const page = paginateCollection_(matches, (req && req.query) || {});
  const fieldMaps = getCachedOnly_("PD_DEAL_FIELDS_MAPS_V2");
  const items = [];

  for (const match of page.items) {
    if (!match || !match.item) continue;
    const deal = enrichDealWithReadableFields_(shapeDealForApi_(match.item.deal, req.query), fieldMaps, match.rowMap);
    deal.ai_summary = buildDealAiSummary_(deal, null);
    const searchItem = buildSearchItemFromDeal_(deal);
    items.push({
      result_score: 1,
      item: searchItem,
      deal: deal,
      ai_context: buildAiDealContext_(searchItem, deal, null)
    });
  }

  return jsonOutput_({
    success: true,
    data: {
      items: items
    },
    additional_data: {
      next_cursor: page.pagination.next_cursor
    }
  });
}

function mergeDealRowEntryLists_() {
  const seenRows = {};
  const out = [];

  for (let i = 0; i < arguments.length; i++) {
    const list = Array.isArray(arguments[i]) ? arguments[i] : [];
    for (const entry of list) {
      if (!entry || !entry.rowNumber || seenRows[entry.rowNumber]) continue;
      seenRows[entry.rowNumber] = true;
      out.push(entry);
    }
  }

  out.sort((a, b) => a.rowNumber - b.rowNumber);
  return out;
}

function findDealRowEntriesByFastSearch_(searchSpec, ctx) {
  const current = ctx || getDealsSheetContext_();
  const kinds = searchSpec && Array.isArray(searchSpec.kinds) ? searchSpec.kinds : [];
  const out = [];

  for (const kind of kinds) {
    const matches = kind === "property_code"
      ? findDealRowEntriesByPropertyCode_(searchSpec && searchSpec.term, current)
      : findDealRowEntriesByNamedField_(kind, searchSpec && searchSpec.term, current);
    out.push.apply(out, matches);
  }

  return mergeDealRowEntryLists_(out);
}

function findDealRowEntriesByPropertyCode_(propertyCode, ctx) {
  const term = String(propertyCode || "").trim();
  if (!term) return [];
  const cacheKey = buildDealsApiCacheKey_("search_property_code", term);
  const current = ctx || getDealsSheetContext_();
  const cachedRows = getCached_(cacheKey, CONFIG.apiSearchCacheTtlSeconds, function() {
    return findDealRowNumbersByPropertyCodeUncached_(current, term);
  });

  const rowNumbers = Array.isArray(cachedRows) ? cachedRows : [];
  if (!rowNumbers.length) return [];

  const out = [];
  for (const rowNumber of rowNumbers) {
    const entry = getDealRowEntryByRowNumber_(current, Number(rowNumber));
    if (entry) out.push(entry);
  }
  out.sort((a, b) => a.rowNumber - b.rowNumber);
  return out;
}

function findDealRowEntriesByNamedField_(kind, term, ctx) {
  const normalizedTerm = normalizeDealSearchTerm_(kind, term);
  if (!normalizedTerm) return [];

  const current = ctx || getDealsSheetContext_();
  const cacheKey = buildDealsApiCacheKey_("search_" + kind, normalizedTerm);
  const cachedRows = getCached_(cacheKey, CONFIG.apiSearchCacheTtlSeconds, function() {
    return findDealRowNumbersByNamedFieldUncached_(current, kind, normalizedTerm);
  });

  const rowNumbers = Array.isArray(cachedRows) ? cachedRows : [];
  if (!rowNumbers.length) return [];

  const out = [];
  for (const rowNumber of rowNumbers) {
    const entry = getDealRowEntryByRowNumber_(current, Number(rowNumber));
    if (entry) out.push(entry);
  }
  out.sort((a, b) => a.rowNumber - b.rowNumber);
  return out;
}

function findDealRowEntriesByPersonIdentitySearch_(searchSpec, ctx) {
  const kinds = searchSpec && Array.isArray(searchSpec.kinds) ? searchSpec.kinds : [];
  const term = searchSpec && searchSpec.term;
  const personIds = new Set();

  for (const kind of kinds) {
    if (kind !== "cpf" && kind !== "email") continue;
    const ids = findPersonIdsByIdentitySearch_(kind, term);
    for (const id of ids) personIds.add(id);
  }

  if (!personIds.size) return [];
  return findDealRowEntriesByPersonIds_(personIds, ctx);
}

function findPersonIdsByIdentitySearch_(kind, term) {
  const normalizedTerm = normalizeDealSearchTerm_(kind, term);
  if (!normalizedTerm) return [];

  const query = {
    term: normalizedTerm,
    exact_match: true,
    limit: 100
  };

  if (kind === "cpf") {
    query.fields = "custom_fields";
  } else if (kind === "email") {
    query.fields = "email,custom_fields";
  } else {
    return [];
  }

  const json = fetchReadonlyUpstreamJson_("/api/v2/persons/search", query);
  const items = json && json.data && Array.isArray(json.data.items) ? json.data.items : [];
  const out = [];

  for (const result of items) {
    const item = result && result.item ? result.item : null;
    const personId = Number(item && item.id);
    if (!isFinite(personId)) continue;
    out.push(personId);
  }

  return Array.from(new Set(out));
}

function findDealRowEntriesByPersonIds_(personIds, ctx) {
  const current = ctx || getDealsSheetContext_();
  const rowNumbers = findDealRowNumbersByPersonIds_(personIds, current);
  if (!rowNumbers.length) return [];

  const out = [];
  for (const rowNumber of rowNumbers) {
    const entry = getDealRowEntryByRowNumber_(current, Number(rowNumber));
    if (entry) out.push(entry);
  }
  out.sort((a, b) => a.rowNumber - b.rowNumber);
  return out;
}

function findDealRowNumbersByPersonIds_(personIds, ctx) {
  const ids = Array.from(personIds || []).map(Number).filter(id => isFinite(id));
  if (!ids.length) return [];

  const cacheKey = buildDealsApiCacheKey_("search_person_ids", ids.slice().sort((a, b) => a - b).join(","));
  return getCached_(cacheKey, CONFIG.apiSearchCacheTtlSeconds, function() {
    return findDealRowNumbersByPersonIdsUncached_(new Set(ids), ctx || getDealsSheetContext_());
  });
}

function findDealRowNumbersByPersonIdsUncached_(personIds, ctx) {
  const dataRows = ctx.lastRow - CONFIG.headerRow;
  if (dataRows <= 0 || !ctx.personIdCol || !personIds || !personIds.size) return [];

  const values = ctx.sheet.getRange(CONFIG.headerRow + 1, ctx.personIdCol, dataRows, 1).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const personId = Number(values[i][0]);
    if (!isFinite(personId) || !personIds.has(personId)) continue;
    out.push(CONFIG.headerRow + 1 + i);
  }
  return out;
}

function findDealRowNumbersByPropertyCodeUncached_(ctx, propertyCode) {
  const dataRows = ctx.lastRow - CONFIG.headerRow;
  if (!ctx.propertyCodeCol || dataRows <= 0) return [];

  try {
    const matches = ctx.sheet
      .getRange(CONFIG.headerRow + 1, ctx.propertyCodeCol, dataRows, 1)
      .createTextFinder(String(propertyCode))
      .matchEntireCell(true)
      .findAll();
    if (matches && matches.length) {
      return matches.map(match => match.getRow());
    }
  } catch (e) {}

  const values = ctx.sheet.getRange(CONFIG.headerRow + 1, ctx.propertyCodeCol, dataRows, 1).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] == null ? "" : values[i][0]).trim() === String(propertyCode)) {
      out.push(CONFIG.headerRow + 1 + i);
    }
  }
  return out;
}

function findDealRowNumbersByNamedFieldUncached_(ctx, kind, normalizedTerm) {
  const dataRows = ctx.lastRow - CONFIG.headerRow;
  const columns = getFastSheetDealsSearchColumns_(ctx, kind);
  if (dataRows <= 0 || !columns.length) return [];

  const matchedRows = {};
  for (const column of columns) {
    const values = ctx.sheet.getRange(CONFIG.headerRow + 1, column, dataRows, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (!doesDealSearchValueMatch_(kind, values[i][0], normalizedTerm)) continue;
      matchedRows[CONFIG.headerRow + 1 + i] = true;
    }
  }

  return Object.keys(matchedRows).map(Number).sort((a, b) => a - b);
}

function getFastSheetDealsSearchColumns_(ctx, kind) {
  if (kind === "cpf") return (ctx && ctx.cpfCols) || [];
  if (kind === "email") return (ctx && ctx.emailCols) || [];
  return [];
}

function doesDealSearchValueMatch_(kind, value, normalizedTerm) {
  if (normalizedTerm === "") return false;

  if (kind === "email") {
    const text = normalizeDealSearchValue_(kind, value);
    if (!text) return false;
    if (text === normalizedTerm) return true;

    const emailTokens = text.match(/[^\s,;<>]+@[^\s,;<>]+/g) || [];
    return emailTokens.indexOf(normalizedTerm) !== -1;
  }

  return normalizeDealSearchValue_(kind, value) === normalizedTerm;
}

function normalizeDealSearchTerm_(kind, value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";

  if (kind === "property_code") return /^\d{7,}$/.test(text) ? text : "";
  if (kind === "cpf") {
    const digits = extractDigits_(text);
    return /^\d{11}$/.test(digits) ? digits : "";
  }
  if (kind === "email") {
    const normalized = text.toLowerCase();
    return /^[^\s@<>]+@[^\s@<>]+$/.test(normalized) ? normalized : "";
  }

  return "";
}

function normalizeDealSearchValue_(kind, value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  if (kind === "cpf") return extractDigits_(text);
  if (kind === "email") return text.toLowerCase();
  return text;
}

function extractDigits_(value) {
  return String(value == null ? "" : value).replace(/\D+/g, "");
}

function getDealRowEntryByRowNumber_(ctx, rowNumber) {
  if (!ctx || !ctx.lastCol || !rowNumber || rowNumber <= CONFIG.headerRow) return null;
  const row = ctx.sheet.getRange(rowNumber, 1, 1, ctx.lastCol).getValues()[0];
  return buildDirectRowEntry_(ctx.headers, row, rowNumber);
}

function buildSearchItemFromDeal_(deal) {
  const owner = deal && deal.owner_id != null ? { id: deal.owner_id } : null;
  if (owner && deal.owner_name) owner.name = deal.owner_name;

  const stage = deal && deal.stage_id != null ? { id: deal.stage_id } : null;
  if (stage && deal.stage_name) stage.name = deal.stage_name;

  const pipeline = deal && deal.pipeline_id != null ? { id: deal.pipeline_id } : null;
  if (pipeline && deal.pipeline_name) pipeline.name = deal.pipeline_name;

  const person = deal && deal.person_id != null ? { id: deal.person_id } : null;
  if (person && deal.person_name) person.name = deal.person_name;

  let organization = null;
  if (deal && (deal.org_id != null || deal.org_name)) {
    organization = {};
    if (deal.org_id != null) organization.id = deal.org_id;
    if (deal.org_name) organization.name = deal.org_name;
  }

  return {
    id: deal && deal.id != null ? deal.id : null,
    type: "deal",
    title: deal && deal.title ? deal.title : "",
    value: deal && deal.value != null ? deal.value : null,
    currency: deal && deal.currency ? deal.currency : "",
    status: deal && deal.status ? deal.status : "",
    visible_to: deal && deal.visible_to != null ? deal.visible_to : null,
    owner: owner,
    stage: stage,
    pipeline: pipeline,
    person: person,
    organization: organization,
    custom_fields: extractSearchItemCustomFields_(deal)
  };
}

function extractSearchItemCustomFields_(deal) {
  const named = deal && deal.custom_fields_by_name ? deal.custom_fields_by_name : {};
  const propertyCode = extractPropertyCode_(deal);
  if (propertyCode !== undefined && propertyCode !== null && propertyCode !== "") return [propertyCode];

  const values = [];
  for (const key of Object.keys(named)) {
    const value = named[key];
    if (value === null || value === undefined || value === "") continue;
    values.push(value);
    if (values.length >= 5) break;
  }
  return values;
}

function getDealsDataset_() {
  const ctx = getDealsSheetContext_();
  const headers = ctx.headers;
  const lastRow = ctx.lastRow;
  const lastCol = ctx.lastCol;

  if (!lastCol || lastRow <= CONFIG.headerRow) {
    return { headers: headers, items: [], hasStoredProducts: false };
  }

  const values = ctx.sheet.getRange(CONFIG.headerRow + 1, 1, lastRow - CONFIG.headerRow, lastCol).getValues();
  const items = [];
  let hasStoredProducts = false;

  for (const row of values) {
    const entry = buildDealEntryFromRow_(headers, row);
    if (!entry) continue;
    if (entry.products.length) hasStoredProducts = true;
    items.push(entry);
  }

  return {
    headers: headers,
    items: items,
    hasStoredProducts: hasStoredProducts
  };
}

function shouldUseDirectDealLookup_(idsSet) {
  return !!(idsSet && idsSet.size && idsSet.size <= CONFIG.apiDirectLookupMaxIds);
}

function getDealsDatasetByIds_(idsSet) {
  const ids = Array.from(idsSet || []);
  const rows = [];
  let hasStoredProducts = false;

  for (const id of ids) {
    const rowEntry = getDealRowEntryById_(id);
    if (!rowEntry || !rowEntry.item) continue;
    if (rowEntry.item.products.length) hasStoredProducts = true;
    rows.push(rowEntry);
  }

  rows.sort((a, b) => a.rowNumber - b.rowNumber);

  return {
    headers: [],
    items: rows.map(x => x.item),
    hasStoredProducts: hasStoredProducts
  };
}

function getDealEntryById_(id) {
  const rowEntry = getDealRowEntryById_(id);
  return rowEntry ? rowEntry.item : null;
}

function getDealRowEntryById_(id) {
  const dealId = Number(id);
  if (!isFinite(dealId)) return null;
  const cacheKey = buildDealsApiCacheKey_("deal_row_entry", dealId);
  return getCached_(cacheKey, CONFIG.apiDetailCacheTtlSeconds, function() {
    return getDealRowEntryByIdUncached_(dealId);
  });
}

function getDealRowEntryByIdUncached_(dealId) {
  const ctx = getDealsSheetContext_();
  if (!ctx.idCol || ctx.lastRow <= CONFIG.headerRow || !ctx.lastCol) return null;

  const rowNumber = findDealRowNumberById_(ctx, dealId);
  if (!rowNumber) return null;

  return getDealRowEntryByRowNumber_(ctx, rowNumber);
}

function getDealsSheetContext_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ensureSheet_(ss, CONFIG.dataSheetName);
  const headers = readHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  const lastCol = headers.length;
  const idCol = lastCol ? findCol_(headers, "Negócio - ID") : 0;
  const propertyCodeCol = lastCol ? findFirstCol_(headers, DEAL_SHEET_PROPERTY_CODE_HEADERS) : 0;
  const cpfCols = findCustomFieldSearchCols_(headers, isCpfSearchHeader_);
  const emailCols = findCustomFieldSearchCols_(headers, isEmailSearchHeader_);

  return {
    sheet: sheet,
    headers: headers,
    lastRow: lastRow,
    lastCol: lastCol,
    idCol: idCol,
    propertyCodeCol: propertyCodeCol,
    cpfCols: cpfCols,
    emailCols: emailCols
  };
}

function findCustomFieldSearchCols_(headers, predicate) {
  const cols = [];
  for (let i = 0; i < (headers || []).length; i++) {
    const header = String(headers[i] || "").trim();
    if (!header || !isCustomSheetFieldHeader_(header)) continue;
    if (!predicate(header)) continue;
    cols.push(i + 1);
  }
  return cols;
}

function isCpfSearchHeader_(header) {
  return normalizeDealSearchHeader_(header).indexOf("cpf") !== -1;
}

function isEmailSearchHeader_(header) {
  return normalizeDealSearchHeader_(header).indexOf("email") !== -1;
}

function normalizeDealSearchHeader_(header) {
  return toAsciiLower_(stripDealSheetPrefix_(header)).replace(/[^a-z0-9]+/g, "");
}

function buildDealEntryFromRow_(headers, row) {
  const direct = buildDirectRowEntry_(headers, row, 0);
  return direct ? direct.item : null;
}

function buildDirectRowEntry_(headers, row, rowNumber) {
  const rowMap = rowToHeaderMap_(headers, row);
  const deal = buildDealFromSheetRow_(rowMap);
  if (!deal || deal.id == null || deal.id === "") return null;

  const products = parseStoredJson_(rowMap[CONFIG.rawProductsHeader]);
  return {
    rowNumber: rowNumber || 0,
    rowMap: rowMap,
    item: {
      deal: deal,
      products: Array.isArray(products) ? products : []
    }
  };
}

function findDealRowNumberById_(ctx, dealId) {
  const cacheKey = buildDealsApiCacheKey_("deal_row", dealId);
  const rowNumber = getCached_(cacheKey, CONFIG.apiRowIndexCacheTtlSeconds, function() {
    const dataRows = ctx.lastRow - CONFIG.headerRow;
    if (dataRows <= 0 || !ctx.idCol) return 0;

    try {
      const range = ctx.sheet.getRange(CONFIG.headerRow + 1, ctx.idCol, dataRows, 1);
      const match = range
        .createTextFinder(String(dealId))
        .matchEntireCell(true)
        .findNext();
      if (match) return match.getRow();
    } catch (e) {}

    const ids = ctx.sheet.getRange(CONFIG.headerRow + 1, ctx.idCol, dataRows, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (Number(ids[i][0]) === Number(dealId)) return CONFIG.headerRow + 1 + i;
    }
    return 0;
  });

  return Number(rowNumber) || 0;
}

function buildDealsApiCacheKey_(prefix, suffix) {
  return ["pd_proxy", prefix, suffix, getDealsApiCacheVersion_()].join(":");
}

function getDealsApiCacheVersion_() {
  const ss = SpreadsheetApp.getActive();
  const sync = ensureSyncSheet_(ss);
  const state = readState_(sync);
  return [
    String(state.last_run_ended || ""),
    String(state.last_sync || ""),
    String(state.rows_in_sheet || "")
  ].join("|");
}

function rowToHeaderMap_(headers, row) {
  const out = {};
  for (let i = 0; i < headers.length; i++) {
    out[String(headers[i] || "")] = row[i];
  }
  return out;
}

function buildDealFromSheetRow_(rowMap) {
  const raw = parseStoredJson_(rowMap[CONFIG.rawDealHeader]);
  const deal = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  applyIfMissing_(deal, "id", asNumberOrText_(rowMap["Negócio - ID"]));
  applyIfMissing_(deal, "title", rowMap["Negócio - Título"]);
  applyIfMissing_(deal, "status", rowMap["Negócio - Status"]);
  applyIfMissing_(deal, "value", asNumberOrText_(rowMap["Negócio - Valor"]));
  applyIfMissing_(deal, "currency", rowMap["Negócio - Moeda de Valor"]);
  applyIfMissing_(deal, "probability", asNumberOrText_(rowMap["Negócio - Probabilidade"]));
  applyIfMissing_(deal, "visible_to", rowMap["Negócio - Visível para"]);
  applyIfMissing_(deal, "org_id", asNumberOrText_(rowMap["Negócio - Organização (id)"]));
  applyIfMissing_(deal, "org_name", rowMap["Negócio - Organização"]);
  applyIfMissing_(deal, "person_id", asNumberOrText_(rowMap["Negócio - Pessoa de contato (id)"]));
  applyIfMissing_(deal, "person_name", rowMap["Negócio - Pessoa de contato"]);
  applyIfMissing_(deal, "owner_id", asNumberOrText_(rowMap["Negócio - Proprietário (id)"]));
  applyIfMissing_(deal, "owner_name", rowMap["Negócio - Proprietário"]);
  applyIfMissing_(deal, "creator_user_id", asNumberOrText_(rowMap["Negócio - Criado por (id)"]));
  applyIfMissing_(deal, "creator_user_name", rowMap["Negócio - Criado por"]);
  applyIfMissing_(deal, "pipeline_id", asNumberOrText_(rowMap["Negócio - Funil (id)"]));
  applyIfMissing_(deal, "pipeline_name", rowMap["Negócio - Funil"]);
  applyIfMissing_(deal, "stage_id", asNumberOrText_(rowMap["Negócio - Etapa (id)"]));
  applyIfMissing_(deal, "stage_name", rowMap["Negócio - Etapa"]);
  applyIfMissing_(deal, "add_time", rowMap["Negócio - Negócio criado em"]);
  applyIfMissing_(deal, "update_time", rowMap["Negócio - Atualizado em"]);
  applyIfMissing_(deal, "stage_change_time", rowMap["Negócio - Última alteração de etapa"]);
  applyIfMissing_(deal, "expected_close_date", rowMap["Negócio - Data de fechamento esperada"]);
  applyIfMissing_(deal, "won_time", rowMap["Negócio - Ganho em"]);
  applyIfMissing_(deal, "lost_time", rowMap["Negócio - Data de perda"]);
  applyIfMissing_(deal, "close_time", rowMap["Negócio - Negócio fechado em"]);
  applyIfMissing_(deal, "lost_reason", rowMap["Negócio - Motivo da perda"]);
  applyIfMissing_(deal, "activities_count", asNumberOrText_(rowMap["Negócio - Total de atividades"]));
  applyIfMissing_(deal, "done_activities_count", asNumberOrText_(rowMap["Negócio - Atividades concluídas"]));
  applyIfMissing_(deal, "undone_activities_count", asNumberOrText_(rowMap["Negócio - Atividades para fazer"]));
  applyIfMissing_(deal, "email_messages_count", asNumberOrText_(rowMap["Negócio - Número de mensagens de e-mail"]));
  applyIfMissing_(deal, "last_incoming_mail_time", rowMap["Negócio - Último e-mail recebido"]);
  applyIfMissing_(deal, "last_outgoing_mail_time", rowMap["Negócio - Último e-mail enviado"]);
  applyIfMissing_(deal, "products_count", asNumberOrText_(rowMap["Negócio - Quantidade de produtos"]));

  return deal;
}

function applyIfMissing_(obj, key, value) {
  if (!obj) return;
  if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return;
  if (value === undefined || value === null || value === "") return;
  obj[key] = value;
}

function asNumberOrText_(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return isFinite(n) ? n : value;
}

function parseStoredJson_(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function filterDealEntries_(items, query) {
  let out = items.slice();
  const ids = parseIdsFilter_(query.ids);
  const statuses = parseStringSet_(query.status);
  const ownerId = numberOrNull_(query.owner_id);
  const personId = numberOrNull_(query.person_id);
  const orgId = numberOrNull_(query.org_id);
  const pipelineId = numberOrNull_(query.pipeline_id);
  const stageId = numberOrNull_(query.stage_id);
  const updatedSince = timeOrNull_(query.updated_since);
  const updatedUntil = timeOrNull_(query.updated_until);

  if (ids) out = out.filter(x => ids.has(Number(x.deal && x.deal.id)));
  if (statuses) out = out.filter(x => statuses.has(String(x.deal && x.deal.status || "").toLowerCase()));
  if (ownerId !== null) out = out.filter(x => Number(x.deal && x.deal.owner_id) === ownerId);
  if (personId !== null) out = out.filter(x => Number(x.deal && x.deal.person_id) === personId);
  if (orgId !== null) out = out.filter(x => Number(x.deal && x.deal.org_id) === orgId);
  if (pipelineId !== null) out = out.filter(x => Number(x.deal && x.deal.pipeline_id) === pipelineId);
  if (stageId !== null) out = out.filter(x => Number(x.deal && x.deal.stage_id) === stageId);
  if (updatedSince !== null) out = out.filter(x => {
    const t = timeOrNull_(x.deal && x.deal.update_time);
    return t !== null && t >= updatedSince;
  });
  if (updatedUntil !== null) out = out.filter(x => {
    const t = timeOrNull_(x.deal && x.deal.update_time);
    return t !== null && t < updatedUntil;
  });

  return out;
}

function sortDealEntries_(items, query) {
  const sortBy = String(query.sort_by || "id").trim().toLowerCase();
  const dir = String(query.sort_direction || "asc").trim().toLowerCase() === "desc" ? -1 : 1;
  const allowed = new Set(["id", "update_time", "add_time"]);
  const field = allowed.has(sortBy) ? sortBy : "id";
  return items.slice().sort((a, b) => compareSortValues_(a.deal && a.deal[field], b.deal && b.deal[field]) * dir);
}

function compareSortValues_(a, b) {
  const ta = timeOrNull_(a);
  const tb = timeOrNull_(b);
  if (ta !== null || tb !== null) {
    const va = ta === null ? -Infinity : ta;
    const vb = tb === null ? -Infinity : tb;
    return va < vb ? -1 : va > vb ? 1 : 0;
  }

  const na = numberOrNull_(a);
  const nb = numberOrNull_(b);
  if (na !== null || nb !== null) {
    const va = na === null ? -Infinity : na;
    const vb = nb === null ? -Infinity : nb;
    return va < vb ? -1 : va > vb ? 1 : 0;
  }

  const sa = String(a == null ? "" : a).toLowerCase();
  const sb = String(b == null ? "" : b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function paginateCollection_(items, query) {
  const limit = parseLimit_(query.limit);
  const offset = parseCursorOffset_(query.cursor);
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < items.length;

  return {
    items: slice,
    pagination: {
      limit: limit,
      more_items_in_collection: hasMore,
      next_cursor: hasMore ? encodeCursorOffset_(nextOffset) : null
    }
  };
}

function parseLimit_(value) {
  const n = Number(value || CONFIG.apiDefaultLimit);
  if (!isFinite(n) || n <= 0) return CONFIG.apiDefaultLimit;
  return Math.min(CONFIG.apiMaxLimit, Math.max(1, Math.floor(n)));
}

function parseCursorOffset_(cursor) {
  const raw = String(cursor || "").trim();
  if (!raw) return 0;
  try {
    const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(raw)).getDataAsString();
    const parsed = JSON.parse(decoded);
    const offset = Number(parsed && parsed.offset);
    return isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  } catch (e) {
    return 0;
  }
}

function encodeCursorOffset_(offset) {
  return Utilities.base64EncodeWebSafe(JSON.stringify({ offset: offset }));
}

function parseIdsFilter_(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map(x => Number(String(x || "").trim()))
    .filter(x => isFinite(x));
  return ids.length ? new Set(ids) : null;
}

function parseStringSet_(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const arr = raw
    .split(",")
    .map(x => String(x || "").trim().toLowerCase())
    .filter(Boolean);
  return arr.length ? new Set(arr) : null;
}

function numberOrNull_(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function timeOrNull_(value) {
  if (value === null || value === undefined || value === "") return null;
  const t = new Date(value).getTime();
  return isFinite(t) ? t : null;
}

function shapeDealForApi_(deal, query) {
  const out = JSON.parse(JSON.stringify(deal || {}));
  if (out.custom_fields && query && query.custom_fields) {
    const allow = parseStringSet_(query.custom_fields);
    if (allow) {
      const picked = {};
      for (const key of Object.keys(out.custom_fields || {})) {
        if (allow.has(String(key).toLowerCase())) picked[key] = out.custom_fields[key];
      }
      out.custom_fields = picked;
    }
  }
  return out;
}

function handleDealsSearch_(req) {
  const query = buildUpstreamQueryParams_((req && req.query) || {});
  const searchJson = fetchReadonlyUpstreamJson_("/api/v2/deals/search", query);
  const items = searchJson && searchJson.data && Array.isArray(searchJson.data.items) ? searchJson.data.items : [];
  if (!items.length) return jsonOutput_(searchJson);

  const fieldMaps = getCachedOnly_("PD_DEAL_FIELDS_MAPS_V2");
  const enrichedItems = [];

  for (const result of items) {
    const originalItem = result && result.item ? result.item : null;
    const dealId = Number(originalItem && originalItem.id);

    if (!isFinite(dealId)) {
      enrichedItems.push(result);
      continue;
    }

    const rowEntry = getDealRowEntryById_(dealId);
    let detailDeal = null;

    if (rowEntry && rowEntry.item) {
      detailDeal = enrichDealWithReadableFields_(shapeDealForApi_(rowEntry.item.deal, (req && req.query) || {}), fieldMaps, rowEntry.rowMap);
    } else {
      const detailJson = fetchReadonlyUpstreamJson_("/api/v2/deals/" + dealId, {});
      detailDeal = detailJson && detailJson.data ? enrichDealWithReadableFields_(detailJson.data, fieldMaps) : null;
    }

    const aiContext = detailDeal ? buildAiDealContext_(originalItem, detailDeal, null) : null;
    if (detailDeal) detailDeal.ai_summary = buildDealAiSummary_(detailDeal, null);

    enrichedItems.push(Object.assign({}, result, {
      item: originalItem,
      deal: detailDeal,
      ai_context: aiContext
    }));
  }

  const data = Object.assign({}, searchJson.data || {}, { items: enrichedItems });
  return jsonOutput_({
    success: searchJson && searchJson.success !== false,
    data: data,
    additional_data: searchJson && searchJson.additional_data !== undefined ? searchJson.additional_data : null
  });
}

function enrichDealWithReadableFields_(deal, fieldMaps, rowMap) {
  const out = JSON.parse(JSON.stringify(deal || {}));
  const customFields = out && out.custom_fields && typeof out.custom_fields === "object" && !Array.isArray(out.custom_fields)
    ? out.custom_fields
    : null;
  applySheetLabelsToDeal_(out, rowMap);

  const sheetViews = buildSheetReadableFieldViews_(rowMap);
  const readable = Object.assign({}, sheetViews.readable);
  const rawByName = Object.assign({}, sheetViews.rawByName);
  const metaByKey = {};
  const keyMap = fieldMaps && fieldMaps.byKey ? fieldMaps.byKey : {};

  if (customFields) {
    for (const key of Object.keys(customFields)) {
      const meta = keyMap[key] || { key: key, name: key, field_type: "" };
      const value = customFields[key];
      const label = uniqueReadableFieldName_(readable, meta.name, key);
      const display = readable[label] !== undefined
        ? {
            display_value: readable[label],
            normalized_value: simplifyReadableValue_(readable[label])
          }
        : resolveReadableFieldValue_(value, meta);

      if (readable[label] === undefined) readable[label] = display.display_value;
      rawByName[label] = value;

      metaByKey[key] = {
        key: key,
        name: meta.name,
        field_type: meta.field_type,
        value: value,
        raw_value: value,
        display_value: display.display_value,
        normalized_value: display.normalized_value
      };
    }
  }

  if (Object.keys(readable).length) {
    out.custom_fields_readable = readable;
    out.custom_fields_by_name = readable;
    out.custom_fields_raw_by_name = rawByName;
  }

  if (Object.keys(metaByKey).length) {
    out.custom_fields_meta = metaByKey;
  } else if (customFields) {
    out.custom_fields_meta = buildFallbackCustomFieldsMeta_(customFields, keyMap);
  }

  return out;
}

function applySheetLabelsToDeal_(deal, rowMap) {
  if (!deal || !rowMap) return;
  applyIfMissing_(deal, "org_name", rowMap["Negócio - Organização"]);
  applyIfMissing_(deal, "person_name", rowMap["Negócio - Pessoa de contato"]);
  applyIfMissing_(deal, "owner_name", rowMap["Negócio - Proprietário"]);
  applyIfMissing_(deal, "creator_user_name", rowMap["Negócio - Criado por"]);
  applyIfMissing_(deal, "pipeline_name", rowMap["Negócio - Funil"]);
  applyIfMissing_(deal, "stage_name", rowMap["Negócio - Etapa"]);
}

function buildSheetReadableFieldViews_(rowMap) {
  const readable = {};
  const rawByName = {};
  if (!rowMap) return { readable: readable, rawByName: rawByName };

  for (const header of Object.keys(rowMap)) {
    if (!isCustomSheetFieldHeader_(header)) continue;
    const value = rowMap[header];
    if (value === null || value === undefined || value === "") continue;
    const label = uniqueReadableFieldName_(readable, stripDealSheetPrefix_(header), header);
    readable[label] = value;
    rawByName[label] = value;
  }

  return { readable: readable, rawByName: rawByName };
}

function isCustomSheetFieldHeader_(header) {
  const text = String(header || "").trim();
  if (!text || DEAL_SHEET_STANDARD_HEADERS.has(text)) return false;
  return text.indexOf("Negócio - ") === 0;
}

function stripDealSheetPrefix_(header) {
  return String(header || "").replace(/^Negócio - /, "").trim();
}

function buildReadableRawFieldMap_(customFields, keyMap) {
  const out = {};
  for (const key of Object.keys(customFields || {})) {
    const meta = (keyMap && keyMap[key]) || { name: key };
    out[uniqueReadableFieldName_(out, meta.name, key)] = customFields[key];
  }
  return out;
}

function buildFallbackCustomFieldsMeta_(customFields, keyMap) {
  const out = {};
  for (const key of Object.keys(customFields || {})) {
    const meta = (keyMap && keyMap[key]) || { name: key, field_type: "" };
    out[key] = {
      key: key,
      name: meta.name,
      field_type: meta.field_type || "",
      value: customFields[key],
      raw_value: customFields[key],
      display_value: customFields[key],
      normalized_value: simplifyReadableValue_(customFields[key])
    };
  }
  return out;
}

function resolveReadableFieldValue_(value, meta) {
  const displayValue = mapFieldValueToDisplay_(value, meta);
  return {
    display_value: displayValue,
    normalized_value: simplifyReadableValue_(displayValue)
  };
}

function mapFieldValueToDisplay_(value, meta) {
  if (value === null || value === undefined || value === "") return value;

  const optionsById = meta && meta.options_by_id ? meta.options_by_id : {};
  const fieldType = String(meta && meta.field_type || "").toLowerCase();

  if ((fieldType === "enum" || fieldType === "visible_to") && Object.keys(optionsById).length) {
    const mapped = optionsById[String(value)];
    return mapped !== undefined ? mapped : value;
  }

  if (fieldType === "set" && Array.isArray(value) && Object.keys(optionsById).length) {
    return value.map(item => {
      const mapped = optionsById[String(item)];
      return mapped !== undefined ? mapped : item;
    });
  }

  if (fieldType === "set" && typeof value === "string" && value.indexOf(",") !== -1 && Object.keys(optionsById).length) {
    return value.split(",").map(item => {
      const token = String(item || "").trim();
      const mapped = optionsById[token];
      return mapped !== undefined ? mapped : token;
    }).filter(Boolean);
  }

  return value;
}

function simplifyReadableValue_(value) {
  if (Array.isArray(value)) return value.map(simplifyReadableValue_);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = simplifyReadableValue_(value[key]);
    return out;
  }
  const text = String(value == null ? "" : value).trim();
  if (!text) return value;
  return text.replace(/^\d+\.\s*/,"").trim() || text;
}

function listNamedCustomFieldEntries_(deal) {
  const named = deal && deal.custom_fields_by_name && typeof deal.custom_fields_by_name === "object"
    ? deal.custom_fields_by_name
    : {};
  const rawByName = deal && deal.custom_fields_raw_by_name && typeof deal.custom_fields_raw_by_name === "object"
    ? deal.custom_fields_raw_by_name
    : {};
  const out = [];

  for (const label of Object.keys(named)) {
    const display = named[label];
    out.push({
      label: label,
      display_value: display,
      normalized_value: simplifyReadableValue_(display),
      raw_value: rawByName[label] !== undefined ? rawByName[label] : display,
      field_type: ""
    });
  }

  if (out.length) return out;

  const customMeta = deal && deal.custom_fields_meta ? deal.custom_fields_meta : {};
  for (const key of Object.keys(customMeta)) {
    const meta = customMeta[key] || {};
    const display = meta.display_value !== undefined ? meta.display_value : meta.value;
    out.push({
      label: String(meta.name || key),
      display_value: display,
      normalized_value: meta.normalized_value !== undefined ? meta.normalized_value : simplifyReadableValue_(display),
      raw_value: meta.raw_value !== undefined ? meta.raw_value : meta.value,
      field_type: String(meta.field_type || "")
    });
  }

  return out;
}

function buildAiDealContext_(searchItem, deal, lookups) {
  const notes = Array.isArray(searchItem && searchItem.notes) ? searchItem.notes : [];
  const important = {
    statuses: {},
    dates: {},
    monetary: {},
    property: {},
    contacts: {}
  };

  for (const entry of listNamedCustomFieldEntries_(deal)) {
    const label = entry.label;
    const value = entry.display_value;
    const type = String(entry.field_type || "").toLowerCase();
    const lower = toAsciiLower_(label);

    if (lower.indexOf("status") !== -1) important.statuses[label] = value;
    if (
      type === "date" ||
      type === "daterange" ||
      type === "date_range" ||
      lower.indexOf("data") !== -1 ||
      lower.indexOf("prazo") !== -1 ||
      lower.indexOf("venc") !== -1
    ) {
      important.dates[label] = value;
    }
    if (type === "monetary" || (value && typeof value === "object" && value.currency !== undefined)) {
      important.monetary[label] = value;
    }
    if (
      lower.indexOf("imovel") !== -1 ||
      lower.indexOf("matricula") !== -1 ||
      lower.indexOf("endereco") !== -1 ||
      lower.indexOf("bairro") !== -1 ||
      lower.indexOf("cidade") !== -1
    ) {
      important.property[label] = value;
    }
    if (
      lower.indexOf("cliente") !== -1 ||
      lower.indexOf("cpf") !== -1 ||
      lower.indexOf("telefone") !== -1 ||
      lower.indexOf("whatsapp") !== -1 ||
      lower.indexOf("email") !== -1 ||
      lower.indexOf("contato") !== -1
    ) {
      important.contacts[label] = value;
    }
  }

  const summary = buildDealAiSummary_(deal, lookups);
  summary.identity.person_name =
    (searchItem && searchItem.person && String(searchItem.person.name || "")) ||
    summary.identity.person_name ||
    "";
  summary.identity.organization_name =
    (searchItem && searchItem.organization && String(searchItem.organization.name || "")) ||
    summary.identity.organization_name ||
    "";
  summary.process.stage_name =
    (searchItem && searchItem.stage && String(searchItem.stage.name || "")) ||
    summary.process.stage_name;

  return {
    summary: summary,
    identity: summary.identity,
    process: summary.process,
    financial: summary.financial,
    dates: summary.dates,
    property: summary.property,
    workflow: summary.workflow,
    notes: {
      count: notes.length,
      latest: notes.slice(0, 10)
    },
    important_custom_fields: important,
    available_payloads: {
      raw_custom_fields: true,
      custom_fields_by_name: true,
      custom_fields_meta: true,
      custom_fields_raw_by_name: true,
      ai_summary: true
    }
  };
}

function buildDealAiSummary_(deal, lookups) {
  const property = {};
  const workflowStatuses = {};
  const workflowStatusDetails = {};
  const workflowExecutors = {};
  const workflowExecutorDetails = {};
  const importantDates = {};
  const importantFinancial = {};
  const contacts = {};

  for (const entry of listNamedCustomFieldEntries_(deal)) {
    const label = entry.label;
    const lowered = toAsciiLower_(label);
    const display = entry.display_value;
    const normalized = entry.normalized_value;
    const rawValue = entry.raw_value;
    const shortStatus = stripLabelPrefix_(label, "Status:");
    const shortExecutor = stripLabelPrefix_(label, "Executor:");

    if (shortStatus) {
      workflowStatuses[shortStatus] = normalized;
      workflowStatusDetails[shortStatus] = {
        raw_value: rawValue,
        display_value: display,
        normalized_value: normalized
      };
    }

    if (shortExecutor) {
      workflowExecutors[shortExecutor] = normalized;
      workflowExecutorDetails[shortExecutor] = {
        raw_value: rawValue,
        display_value: display,
        normalized_value: normalized
      };
    }

    if (
      lowered.indexOf("imovel") !== -1 ||
      lowered.indexOf("matricula") !== -1 ||
      lowered.indexOf("endereco") !== -1 ||
      lowered.indexOf("bairro") !== -1 ||
      lowered.indexOf("cidade") !== -1 ||
      lowered.indexOf("ocupado") !== -1 ||
      lowered.indexOf("tipo de imovel") !== -1 ||
      lowered.indexOf("modalidade") !== -1
    ) {
      property[label] = normalized;
    }

    if (
      lowered.indexOf("cliente") !== -1 ||
      lowered.indexOf("cpf") !== -1 ||
      lowered.indexOf("telefone") !== -1 ||
      lowered.indexOf("whatsapp") !== -1 ||
      lowered.indexOf("email") !== -1 ||
      lowered.indexOf("contato") !== -1
    ) {
      contacts[label] = normalized;
    }

    if (
      String(entry.field_type || "").toLowerCase() === "date" ||
      String(entry.field_type || "").toLowerCase() === "daterange" ||
      String(entry.field_type || "").toLowerCase() === "date_range" ||
      lowered.indexOf("data") !== -1 ||
      lowered.indexOf("prazo") !== -1 ||
      lowered.indexOf("venc") !== -1
    ) {
      importantDates[label] = normalized;
    }

    if (
      String(entry.field_type || "").toLowerCase() === "monetary" ||
      lowered.indexOf("valor") !== -1 ||
      lowered.indexOf("preco") !== -1 ||
      lowered.indexOf("pagamento") !== -1 ||
      lowered.indexOf("fgts") !== -1
    ) {
      importantFinancial[label] = normalized;
    }
  }

  return {
    identity: {
      deal_id: deal.id == null ? null : deal.id,
      title: deal.title || "",
      property_code: extractPropertyCode_(deal),
      person_id: deal.person_id == null ? null : deal.person_id,
      person_name: deal.person_name || "",
      organization_id: deal.org_id == null ? null : deal.org_id,
      organization_name: deal.org_name || "",
      owner_id: deal.owner_id == null ? null : deal.owner_id,
      owner_name: deal.owner_name || lookupName_(lookups && lookups.users, deal.owner_id)
    },
    process: {
      deal_status: deal.status || "",
      pipeline_id: deal.pipeline_id == null ? null : deal.pipeline_id,
      pipeline_name: deal.pipeline_name || lookupName_(lookups && lookups.pipelines, deal.pipeline_id),
      stage_id: deal.stage_id == null ? null : deal.stage_id,
      stage_name: deal.stage_name || lookupName_(lookups && lookups.stages, deal.stage_id),
      visible_to: deal.visible_to == null ? null : deal.visible_to,
      is_archived: !!deal.is_archived,
      is_deleted: !!deal.is_deleted
    },
    workflow: {
      statuses: workflowStatuses,
      statuses_detailed: workflowStatusDetails,
      executors: workflowExecutors,
      executors_detailed: workflowExecutorDetails
    },
    property: property,
    contacts: contacts,
    financial: {
      value: deal.value == null ? null : deal.value,
      currency: deal.currency || "",
      probability: deal.probability == null ? null : deal.probability,
      acv: deal.acv == null ? null : deal.acv,
      arr: deal.arr == null ? null : deal.arr,
      mrr: deal.mrr == null ? null : deal.mrr,
      important_custom_fields: importantFinancial
    },
    dates: {
      add_time: deal.add_time || "",
      update_time: deal.update_time || "",
      stage_change_time: deal.stage_change_time || "",
      expected_close_date: deal.expected_close_date || "",
      close_time: deal.close_time || "",
      won_time: deal.won_time || "",
      lost_time: deal.lost_time || "",
      local_won_date: deal.local_won_date || "",
      local_lost_date: deal.local_lost_date || "",
      local_close_date: deal.local_close_date || "",
      important_custom_fields: importantDates
    }
  };
}

function extractPropertyCode_(deal) {
  const named = deal && deal.custom_fields_by_name ? deal.custom_fields_by_name : {};
  const candidates = [
    "Número do Imóvel",
    "Numero do Imovel",
    "Código do Imóvel",
    "Codigo do Imovel",
    "Código do imóvel",
    "Codigo do imovel"
  ];

  for (const name of candidates) {
    const value = named[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }

  const title = String((deal && deal.title) || "");
  const match = title.match(/\b\d{7,}\b/);
  return match ? match[0] : "";
}

function lookupName_(map, id) {
  if (!map || id == null || id === "") return "";
  const value = map[String(id)];
  return value == null ? "" : String(value);
}

function toAsciiLower_(value) {
  let text = String(value == null ? "" : value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {}
  return text;
}

function stripLabelPrefix_(value, prefix) {
  const text = String(value || "").trim();
  const expected = String(prefix || "").trim();
  if (!text || !expected) return "";
  const normalizedText = toAsciiLower_(text);
  const normalizedPrefix = toAsciiLower_(expected);
  if (normalizedText.indexOf(normalizedPrefix) !== 0) return "";
  return text.substring(expected.length).replace(/^[:\s-]+/, "").trim();
}

function uniqueReadableFieldName_(target, preferredName, key) {
  const base = String(preferredName || key || "").trim() || String(key || "");
  if (!target || target[base] === undefined) return base;
  return base + " [" + String(key || "") + "]";
}

function proxyReadonlyUpstreamGet_(req) {
  const path = String(req.path || "");
  const query = buildUpstreamQueryParams_(req.query || {});
  const json = fetchReadonlyUpstreamJson_(path, query);
  return jsonOutput_(json);
}

function fetchReadonlyUpstreamJson_(path, query) {
  const cacheKey = buildReadonlyUpstreamCacheKey_(path, query);
  return getCached_(cacheKey, CONFIG.apiReadonlyUpstreamCacheTtlSeconds, function() {
    if (String(path || "").indexOf("/api/v2/") === 0) {
      return pipedriveGetV2_(String(path || "").substring("/api/v2".length), query);
    }
    if (String(path || "").indexOf("/v1/") === 0) {
      return pipedriveGetV1_(String(path || "").substring("/v1".length), query);
    }
    throw new Error("Rota readonly upstream inválida.");
  });
}

function buildUpstreamQueryParams_(query) {
  const out = Object.assign({}, query || {});
  delete out.api_token;
  delete out.path;
  delete out.endpoint;
  delete out.method;
  delete out._method;
  delete out.search_by;
  return out;
}

function buildReadonlyUpstreamCacheKey_(path, query) {
  const keys = Object.keys(query || {}).sort();
  const parts = [String(path || "")];
  for (const key of keys) {
    const value = query[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(key + "=" + String(value));
  }
  return ["pd_proxy_upstream", parts.join("&")].join(":");
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorOutput_(message, info) {
  return jsonOutput_({
    success: false,
    error: message,
    error_info: info || "",
    data: null,
    additional_data: null
  });
}
