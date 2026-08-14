/*
 * XForm Revival worker client. The document thread only hydrates, sends intents,
 * and routes immutable engine patches; it does not own model state.
 */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const PROTOCOL_VERSION = 1;

  const clientScriptUrl = document.currentScript?.src || globalThis.location?.href;

  function defaultWorkerUrl() {
    const extension = globalThis.browser?.runtime || globalThis.chrome?.runtime;
    return extension?.getURL?.("src/worker/xform-engine-worker.js") || new URL("xform-engine-worker.js", clientScriptUrl).href;
  }

  class XFormEngineClient extends EventTarget {
    constructor({ workerUrl = defaultWorkerUrl(), onDiagnostic = console.warn } = {}) {
      super();
      this.worker = new Worker(workerUrl);
      this.sequence = 0;
      this.lastApplied = 0;
      this.components = new Map();
      this.onDiagnostic = onDiagnostic;
      this.worker.onmessage = ({ data }) => this.receive(data);
      this.worker.onerror = (event) => this.onDiagnostic("XForms worker error", event.message);
    }

    hydrate({ nodeCount, dependencies = [], initialValues = [], initialModelItemFlags = [], inlineInstanceXml = null }) {
      return this.request("hydrate", { nodeCount, dependencies, initialValues, initialModelItemFlags, inlineInstanceXml });
    }

    registerComponent(nodeId, component) {
      this.components.set(Number(nodeId), component);
    }

    unregisterComponent(nodeId, component) {
      if (this.components.get(Number(nodeId)) === component) this.components.delete(Number(nodeId));
    }

    intent(intent) {
      return this.request("intent", { intent });
    }

    reset() {
      return this.request("reset", {});
    }

    querySimplePath(path, contextNodes = []) {
      return this.request("simple-path-query", { path, contextNodes });
    }

    submitCalculatedValues(originSequence, values) {
      return this.request("calculated-values", { originSequence, values });
    }

    submitResolvedModelItemState(originSequence, entries) {
      return this.request("resolved-model-item-state", { originSequence, entries });
    }

    request(kind, body) {
      const sequence = ++this.sequence;
      this.worker.postMessage({ protocolVersion: PROTOCOL_VERSION, kind, sequence, ...body });
      return sequence;
    }

    receive(message) {
      if (!message || message.protocolVersion !== PROTOCOL_VERSION) {
        const received = message?.protocolVersion ?? "missing";
        this.onDiagnostic(`[XForm Revival] worker protocol mismatch: expected ${PROTOCOL_VERSION}, received ${received}.`);
        this.dispatchEvent(new CustomEvent("diagnostic", { detail: {
          kind: "diagnostic",
          level: "error",
          code: "protocol-version-mismatch",
          expectedProtocolVersion: PROTOCOL_VERSION,
          receivedProtocolVersion: message?.protocolVersion
        } }));
        return;
      }
      if (typeof message.kind !== "string") {
        this.onDiagnostic("[XForm Revival] worker reply omitted its message kind.");
        return;
      }
      if (message.kind === "diagnostic") {
        this.onDiagnostic("[XForm Revival]", message.message);
        this.dispatchEvent(new CustomEvent("diagnostic", { detail: message }));
        return;
      }
      if (message.sequence && message.sequence < this.lastApplied) return;
      if (message.kind === "patches") {
        this.lastApplied = message.sequence;
        for (const patch of message.patches) {
          const component = this.components.get(Number(patch.nodeId));
          component?.applyEnginePatch?.(patch);
        }
        this.dispatchEvent(new CustomEvent("patches", { detail: message }));
      } else {
        this.dispatchEvent(new CustomEvent(message.kind, { detail: message }));
      }
    }

    dispose() {
      this.request("dispose", {});
      this.worker.terminate();
      this.components.clear();
    }
  }

  root.XFORM_WORKER_PROTOCOL_VERSION = PROTOCOL_VERSION;
  root.XFormEngineClient = XFormEngineClient;
})();
