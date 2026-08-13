/*
 * XForm Revival worker client. The document thread only hydrates, sends intents,
 * and routes immutable engine patches; it does not own model state.
 */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};

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

    hydrate({ nodeCount, dependencies = [] }) {
      return this.request("hydrate", { nodeCount, dependencies });
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

    request(kind, body) {
      const sequence = ++this.sequence;
      this.worker.postMessage({ kind, sequence, ...body });
      return sequence;
    }

    receive(message) {
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

  root.XFormEngineClient = XFormEngineClient;
})();
