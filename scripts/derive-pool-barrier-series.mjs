#!/usr/bin/env node
/**
 * Derives the pool's barrier series from declared member obligations. Reads a request
 * `{baseFloor, obligations, leadDays?}` via `--request` or stdin. One optional effect:
 * when `--state <path>` is given, persists the series onto the pool document.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { derivePoolBarrierSeries } from "../src/pool.mjs";
import { readStore, writeStore } from "../src/store.mjs";

/**
 * Derives a barrier series from `request`, optionally persisting it onto the pool document
 * at `statePath`.
 * @param {object} request `{baseFloor, obligations, leadDays?}`.
 * @param {string|null} [statePath] Path to the pool's persisted JSON document, or null to skip persisting.
 * @returns {{date: string, amount: string}[]} The derived barrier series.
 */
export function derivePoolBarrierSeriesFromRequest(request, statePath = null) {
  const series = derivePoolBarrierSeries(request);
  if (statePath) {
    const document = readStore(statePath, null);
    if (!document) throw new Error(`derive-pool-barrier-series: no pool document at ${statePath}`);
    writeStore(statePath, { ...document, pool: { ...document.pool, barrierSeries: series, barrierFloor: request.baseFloor } });
  }
  return series;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, request: { type: "string" } } });
  const requestText = values.request ?? readFileSync(0, "utf8");
  const series = derivePoolBarrierSeriesFromRequest(JSON.parse(requestText), values.state ?? null);
  process.stdout.write(`${JSON.stringify(series)}\n`);
}
