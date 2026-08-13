/*
 * XForm Revival worker bridge.
 * The worker owns the Rust/Wasm handle. No DOM objects cross this boundary.
 */
"use strict";

const PROTOCOL_VERSION = 1;
const MODEL_ITEM_FLAGS = Object.freeze({ relevant: 0x01, readonly: 0x02, required: 0x04, valid: 0x08 });
const MODEL_ITEM_FLAGS_ALL = MODEL_ITEM_FLAGS.relevant | MODEL_ITEM_FLAGS.readonly | MODEL_ITEM_FLAGS.required | MODEL_ITEM_FLAGS.valid;
let wasm = null;
let engine = 0;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let lastSequence = 0;

async function boot() {
  if (wasm) return wasm;
  const response = await fetch(new URL("./xform_engine.wasm", self.location.href));
  if (!response.ok) throw new Error(`Unable to fetch Wasm engine: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  wasm = instance.exports;
  const requiredExports = [
    "memory", "xfr_engine_create", "xfr_engine_destroy", "xfr_alloc", "xfr_dealloc",
    "xfr_engine_set_value", "xfr_engine_value_length", "xfr_engine_copy_value",
    "xfr_engine_set_model_item_flags", "xfr_engine_model_item_flags"
  ];
  if (!requiredExports.every((name) => wasm[name])) throw new Error("Wasm engine exports are incomplete.");
  return wasm;
}

function assertEngine() {
  if (!engine) throw new Error("The XForms worker has not been hydrated.");
}

function readValue(nodeId) {
  const byteLength = wasm.xfr_engine_value_length(engine, nodeId);
  if (byteLength < 0) throw new Error(`Unable to read model value for node ${nodeId}: ${byteLength}.`);
  if (byteLength === 0) return "";
  const pointer = wasm.xfr_alloc(byteLength);
  try {
    const copied = wasm.xfr_engine_copy_value(engine, nodeId, pointer, byteLength);
    if (copied !== byteLength) throw new Error(`Unable to copy model value for node ${nodeId}: ${copied}.`);
    return textDecoder.decode(new Uint8Array(wasm.memory.buffer, pointer, byteLength));
  } finally {
    wasm.xfr_dealloc(pointer, byteLength);
  }
}

function modelItemState(nodeId) {
  const flags = wasm.xfr_engine_model_item_flags(engine, nodeId);
  if (flags < 0) throw new Error(`Unable to read model-item state for node ${nodeId}: ${flags}.`);
  return {
    relevant: (flags & MODEL_ITEM_FLAGS.relevant) !== 0,
    readonly: (flags & MODEL_ITEM_FLAGS.readonly) !== 0,
    required: (flags & MODEL_ITEM_FLAGS.required) !== 0,
    valid: (flags & MODEL_ITEM_FLAGS.valid) !== 0
  };
}

function setModelItemFlags(nodeId, flags) {
  const status = wasm.xfr_engine_set_model_item_flags(engine, nodeId, flags);
  if (status !== 0) throw new Error(`Unable to set model-item state for node ${nodeId}: ${status}.`);
}

function validNodeId(value, nodeCount, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= nodeCount) {
    throw new Error(`${field} must be a non-negative safe integer below nodeCount.`);
  }
  return value;
}

function validateDistinctEntries(entries, nodeCount, field, validateEntry) {
  if (!Array.isArray(entries)) throw new Error(`${field} must be an array.`);
  const seen = new Set();
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`${field}[${index}] must be an object.`);
    const nodeId = validNodeId(entry.nodeId, nodeCount, `${field}[${index}].nodeId`);
    if (seen.has(nodeId)) throw new Error(`${field} contains duplicate nodeId ${nodeId}.`);
    seen.add(nodeId);
    return validateEntry(entry, nodeId, index);
  });
}

function validateHydration(message) {
  const nodeCount = message.nodeCount;
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 0 || nodeCount > 0xffffffff) {
    throw new Error("hydrate.nodeCount must be a non-negative u32 integer.");
  }
  if (!Array.isArray(message.dependencies)) throw new Error("hydrate.dependencies must be an array.");
  const dependencies = message.dependencies.map((edge, index) => {
    if (!edge || typeof edge !== "object") throw new Error(`hydrate.dependencies[${index}] must be an object.`);
    return {
      source: validNodeId(edge.source, nodeCount, `hydrate.dependencies[${index}].source`),
      dependent: validNodeId(edge.dependent, nodeCount, `hydrate.dependencies[${index}].dependent`)
    };
  });
  const initialValues = validateDistinctEntries(message.initialValues ?? [], nodeCount, "hydrate.initialValues", (entry, nodeId, index) => {
    if (typeof entry.value !== "string") throw new Error(`hydrate.initialValues[${index}].value must be a string.`);
    return { nodeId, value: entry.value };
  });
  const initialModelItemFlags = validateDistinctEntries(message.initialModelItemFlags ?? [], nodeCount, "hydrate.initialModelItemFlags", (entry, nodeId, index) => {
    const { flags } = entry;
    if (!Number.isSafeInteger(flags) || flags < 0 || flags > 0xffffffff || (flags & ~MODEL_ITEM_FLAGS_ALL) !== 0) {
      throw new Error(`hydrate.initialModelItemFlags[${index}].flags contains invalid or reserved bits.`);
    }
    return { nodeId, flags };
  });
  return { nodeCount, dependencies, initialValues, initialModelItemFlags };
}

function setValue(nodeId, value) {
  if (typeof value !== "string") throw new Error("The current worker accepts scalar string set-value intents only.");
  const bytes = textEncoder.encode(value);
  if (bytes.byteLength === 0) {
    const status = wasm.xfr_engine_set_value(engine, nodeId, 0, 0);
    if (status !== 0) throw new Error(`Unable to set model value for node ${nodeId}: ${status}.`);
    return;
  }
  const pointer = wasm.xfr_alloc(bytes.byteLength);
  try {
    new Uint8Array(wasm.memory.buffer, pointer, bytes.byteLength).set(bytes);
    const status = wasm.xfr_engine_set_value(engine, nodeId, pointer, bytes.byteLength);
    if (status !== 0) throw new Error(`Unable to set model value for node ${nodeId}: ${status}.`);
  } finally {
    wasm.xfr_dealloc(pointer, bytes.byteLength);
  }
}

function changedNodes(summary) {
  if (!summary.changed_count) return [];
  const bytes = summary.changed_count * Uint32Array.BYTES_PER_ELEMENT;
  const pointer = wasm.xfr_alloc(bytes);
  try {
    const count = wasm.xfr_engine_take_changed(engine, pointer, summary.changed_count);
    if (count < 0) throw new Error(`Patch buffer capacity failure; required ${-count} nodes.`);
    // `readValue` allocates in Wasm memory, which may replace the backing
    // ArrayBuffer. Copy node IDs before any value read can trigger growth.
    const nodeIds = Array.from(new Uint32Array(wasm.memory.buffer, pointer, count));
    return nodeIds.map((nodeId) => ({
      nodeId,
      version: wasm.xfr_engine_node_version(engine, nodeId),
      state: { value: readValue(nodeId), ...modelItemState(nodeId) }
    }));
  } finally {
    wasm.xfr_dealloc(pointer, bytes);
  }
}

function postProtocolMessage(message) {
  postMessage({ protocolVersion: PROTOCOL_VERSION, ...message });
}

function postDiagnostic(message, { sequence = 0, code = "worker-error", expectedProtocolVersion, receivedProtocolVersion } = {}) {
  postProtocolMessage({
    kind: "diagnostic",
    sequence,
    level: "error",
    code,
    message,
    ...(expectedProtocolVersion === undefined ? {} : { expectedProtocolVersion }),
    ...(receivedProtocolVersion === undefined ? {} : { receivedProtocolVersion })
  });
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
  if (!summary.changed_count) return false;
  const patches = changedNodes(summary);
  postProtocolMessage({
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
  return true;
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      postDiagnostic(
        `Worker protocol mismatch: expected ${PROTOCOL_VERSION}, received ${message.protocolVersion ?? "missing"}.`,
        {
          sequence: message.sequence || 0,
          code: "protocol-version-mismatch",
          expectedProtocolVersion: PROTOCOL_VERSION,
          receivedProtocolVersion: message.protocolVersion
        }
      );
      return;
    }
    if (typeof message.kind !== "string") throw new Error("Worker request omitted its message kind.");
    await boot();
    if (message.kind === "hydrate") {
      const startedAt = performance.now();
      const hydration = validateHydration(message);
      if (engine) wasm.xfr_engine_destroy(engine);
      engine = wasm.xfr_engine_create(hydration.nodeCount);
      for (const edge of hydration.dependencies) {
        const status = wasm.xfr_engine_add_dependency(engine, edge.source, edge.dependent);
        if (status !== 0) throw new Error(`Invalid dependency ${edge.source} → ${edge.dependent}.`);
      }
      for (const projection of hydration.initialValues) setValue(projection.nodeId, projection.value);
      for (const projection of hydration.initialModelItemFlags) setModelItemFlags(projection.nodeId, projection.flags);
      lastSequence = message.sequence || 0;
      postProtocolMessage({
        kind: "hydrated",
        sequence: lastSequence,
        nodeCount: hydration.nodeCount,
        dependencyCount: hydration.dependencies.length,
        initialValueCount: hydration.initialValues.length,
        initialModelItemFlagCount: hydration.initialModelItemFlags.length,
        metrics: { workerHydrationMs: performance.now() - startedAt }
      });
      update(lastSequence);
      return;
    }
    if (message.kind === "intent") {
      assertEngine();
      const sequence = message.sequence >>> 0;
      if (sequence <= lastSequence) return;
      lastSequence = sequence;
      if (message.intent?.kind === "set-value") {
        setValue(message.intent.nodeId >>> 0, message.intent.value);
        update(sequence);
        return;
      }
      if (message.intent?.kind === "activate") {
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
      postProtocolMessage({ kind: "disposed" });
      return;
    }
    throw new Error(`Unsupported worker message '${message.kind}'.`);
  } catch (error) {
    postDiagnostic(error.message, { sequence: message.sequence || 0 });
  }
};
