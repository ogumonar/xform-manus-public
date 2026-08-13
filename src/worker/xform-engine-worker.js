/*
 * XForm Revival worker bridge.
 * The worker owns the Rust/Wasm handle. No DOM objects cross this boundary.
 */
"use strict";

let wasm = null;
let engine = 0;
let lastSequence = 0;

async function boot() {
  if (wasm) return wasm;
  const response = await fetch(new URL("./xform_engine.wasm", self.location.href));
  if (!response.ok) throw new Error(`Unable to fetch Wasm engine: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  wasm = instance.exports;
  if (!wasm.memory || !wasm.xfr_engine_create) throw new Error("Wasm engine exports are incomplete.");
  return wasm;
}

function assertEngine() {
  if (!engine) throw new Error("The XForms worker has not been hydrated.");
}

function changedNodes(summary) {
  if (!summary.changed_count) return [];
  const bytes = summary.changed_count * Uint32Array.BYTES_PER_ELEMENT;
  const pointer = wasm.xfr_alloc(bytes);
  try {
    const count = wasm.xfr_engine_take_changed(engine, pointer, summary.changed_count);
    if (count < 0) throw new Error(`Patch buffer capacity failure; required ${-count} nodes.`);
    const view = new Uint32Array(wasm.memory.buffer, pointer, count);
    return Array.from(view, (nodeId) => ({ nodeId, version: wasm.xfr_engine_node_version(engine, nodeId) }));
  } finally {
    wasm.xfr_dealloc(pointer, bytes);
  }
}

function update(sequence) {
  const startedAt = performance.now();
  const changedCount = wasm.xfr_engine_run_update(engine);
  if (changedCount < 0) throw new Error(`Wasm update failed with status ${changedCount}.`);
  const summary = {
    changed_count: changedCount,
    dirty_count: wasm.xfr_engine_last_dirty_count(engine),
    transaction_version: wasm.xfr_engine_transaction_version(engine)
  };
  const patches = changedNodes(summary);
  postMessage({
    kind: "patches",
    sequence,
    patches,
    metrics: {
      dirtyNodes: summary.dirty_count,
      changedNodes: summary.changed_count,
      transactionVersion: summary.transaction_version,
      workerUpdateMs: performance.now() - startedAt
    }
  });
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    await boot();
    if (message.kind === "hydrate") {
      const startedAt = performance.now();
      if (engine) wasm.xfr_engine_destroy(engine);
      engine = wasm.xfr_engine_create(message.nodeCount >>> 0);
      for (const edge of message.dependencies || []) {
        const status = wasm.xfr_engine_add_dependency(engine, edge.source >>> 0, edge.dependent >>> 0);
        if (status !== 0) throw new Error(`Invalid dependency ${edge.source} → ${edge.dependent}.`);
      }
      lastSequence = message.sequence || 0;
      postMessage({ kind: "hydrated", sequence: lastSequence, nodeCount: message.nodeCount, dependencyCount: (message.dependencies || []).length, metrics: { workerHydrationMs: performance.now() - startedAt } });
      return;
    }
    if (message.kind === "intent") {
      assertEngine();
      const sequence = message.sequence >>> 0;
      if (sequence <= lastSequence) return;
      lastSequence = sequence;
      if (message.intent?.kind === "set-value" || message.intent?.kind === "activate") {
        const status = wasm.xfr_engine_mark_value_changed(engine, message.intent.nodeId >>> 0);
        if (status !== 0) throw new Error(`Unknown model node ${message.intent.nodeId}.`);
        update(sequence);
        return;
      }
      throw new Error(`Unsupported worker intent '${message.intent?.kind}'.`);
    }
    if (message.kind === "dispose") {
      if (engine) wasm.xfr_engine_destroy(engine);
      engine = 0;
      postMessage({ kind: "disposed" });
      return;
    }
    throw new Error(`Unsupported worker message '${message.kind}'.`);
  } catch (error) {
    postMessage({ kind: "diagnostic", sequence: message.sequence || 0, level: "error", message: error.message });
  }
};
