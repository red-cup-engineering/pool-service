/**
 * Ledger-witness resolution for Tidepool membership v2.
 *
 * A membership record carries a descriptor, never an ambient server pathname as its public
 * identity. Resolution either produces the existing canonical {postings:[...]} document or a
 * typed unavailable/refused result. The reconciliation algebra remains in pool.mjs.
 */
import { createHash } from "node:crypto";

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`ledger-witness: ${label} must be a non-empty string`);
  }
  return value;
}

/** Return the house ni:///sha-256 digest for the exact bytes supplied by a witness provider. */
export function recordNiForBytes(bytes) {
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : bytes instanceof Uint8Array
      ? Buffer.from(bytes)
      : Buffer.from(String(bytes), "utf8");
  return `ni:///sha-256;${createHash("sha256").update(buffer).digest("base64url")}`;
}

/**
 * Validate and freeze the posting-array contract consumed by reconcilePoolBooks.
 */
export function canonicalPostingDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.postings)) {
    throw new TypeError("ledger-witness: resolved document must be an object with postings[]");
  }
  const postings = value.postings.map((posting, index) => {
    if (!posting || typeof posting !== "object" || Array.isArray(posting)) {
      throw new TypeError(`ledger-witness: postings[${index}] must be an object`);
    }
    for (const field of ["date", "ref", "account", "amount", "commodity"]) {
      requireText(posting[field], `postings[${index}].${field}`);
    }
    return Object.freeze({
      date: posting.date,
      ref: posting.ref,
      account: posting.account,
      amount: posting.amount,
      commodity: posting.commodity,
    });
  });
  return Object.freeze({ postings: Object.freeze(postings) });
}

/**
 * Validate a stored witness descriptor.
 *
 * content-addressed-postings is the public v2 shape. local-file is retained only as the
 * deterministic adapter for historical 0.5.0 membership records.
 */
export function normalizeLedgerWitness(witness) {
  if (!witness || typeof witness !== "object" || Array.isArray(witness)) {
    throw new TypeError("ledger-witness: descriptor must be an object");
  }
  if (witness.kind === "content-addressed-postings") {
    return Object.freeze({
      kind: "content-addressed-postings",
      recordNi: requireText(witness.recordNi, "recordNi"),
      provider: requireText(witness.provider, "provider"),
      subject: requireText(witness.subject, "subject"),
    });
  }
  if (witness.kind === "local-file") {
    return Object.freeze({
      kind: "local-file",
      path: requireText(witness.path, "path"),
    });
  }
  throw new TypeError(`ledger-witness: unsupported kind ${JSON.stringify(witness.kind)}`);
}

function parsePostingBytes(bytes) {
  const text = Buffer.isBuffer(bytes) || bytes instanceof Uint8Array
    ? Buffer.from(bytes).toString("utf8")
    : String(bytes);
  return canonicalPostingDocument(JSON.parse(text));
}

/**
 * Resolve a member-controlled witness into posting arrays.
 *
 * Provider exceptions/missing providers are unavailable. Invalid data, NI mismatch, or an
 * invalid descriptor are refused. Neither case is represented as an empty posting list.
 */
export function resolveLedgerWitness(witness, {
  readLocalFile = null,
  fetchContentAddressed = null,
} = {}) {
  let descriptor;
  try {
    descriptor = normalizeLedgerWitness(witness);
  } catch (error) {
    return Object.freeze({ resolved: false, state: "refused", reason: error.message });
  }

  if (descriptor.kind === "local-file") {
    if (typeof readLocalFile !== "function") {
      return Object.freeze({ resolved: false, state: "unavailable", reason: "ledger-witness: local-file provider is unavailable" });
    }
    let bytes;
    try {
      bytes = readLocalFile(descriptor.path);
    } catch (error) {
      return Object.freeze({ resolved: false, state: "unavailable", reason: `ledger-witness: local-file provider failed: ${error.message}` });
    }
    try {
      const document = parsePostingBytes(bytes);
      return Object.freeze({ resolved: true, descriptor, postings: document.postings });
    } catch (error) {
      return Object.freeze({ resolved: false, state: "refused", reason: `ledger-witness: local-file content refused: ${error.message}` });
    }
  }

  if (typeof fetchContentAddressed !== "function") {
    return Object.freeze({ resolved: false, state: "unavailable", reason: `ledger-witness: content provider ${JSON.stringify(descriptor.provider)} is unavailable` });
  }

  let bytes;
  try {
    bytes = fetchContentAddressed(descriptor);
  } catch (error) {
    return Object.freeze({ resolved: false, state: "unavailable", reason: `ledger-witness: content provider failed: ${error.message}` });
  }
  if (bytes === null || bytes === undefined) {
    return Object.freeze({ resolved: false, state: "unavailable", reason: "ledger-witness: content provider returned no record" });
  }

  const actualNi = recordNiForBytes(bytes);
  if (actualNi !== descriptor.recordNi) {
    return Object.freeze({
      resolved: false,
      state: "refused",
      reason: `ledger-witness: recordNi mismatch: expected ${descriptor.recordNi}, got ${actualNi}`,
    });
  }

  try {
    const document = parsePostingBytes(bytes);
    return Object.freeze({ resolved: true, descriptor, postings: document.postings });
  } catch (error) {
    return Object.freeze({ resolved: false, state: "refused", reason: `ledger-witness: content refused: ${error.message}` });
  }
}
