/* XForm Revival — constrained direct xf:setvalue action bridge. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};

  class SetValueActionError extends Error {
    constructor(code, message) { super(message); this.name = "SetValueActionError"; this.code = code; }
  }

  class XFormsSetValueActionBridge {
    static create({ host, client, inlineInstanceXml } = {}) {
      if (!host || !client) throw new SetValueActionError("missing-action-host", "Setvalue action bridge requires a host and worker client.");
      if (!root.XFormsPropertyEvaluator?.evaluate) throw new SetValueActionError("evaluator-unavailable", "Load xforms-property-evaluator.js before the setvalue action bridge.");
      const documentNode = new DOMParser().parseFromString(inlineInstanceXml, "application/xml");
      if (documentNode.querySelector("parsererror")) throw new SetValueActionError("invalid-instance", "Cannot parse inline XML for setvalue actions.");
      return new XFormsSetValueActionBridge(host, client, documentNode);
    }

    constructor(host, client, documentNode) {
      this.host = host;
      this.client = client;
      this.documentNode = documentNode;
      this.actions = new Map();
      this.pending = new Map();
      this.onIntent = (event) => this.activate(event.detail);
      this.onQuery = (event) => this.applyQuery(event.detail);
      host.addEventListener("xforms-intent", this.onIntent);
      client.addEventListener("simple-path-result", this.onQuery);
      this.discover();
    }

    discover() {
      for (const trigger of this.host.querySelectorAll("xf\\:trigger[id]")) {
        const action = Array.from(trigger.children).find((child) => child.namespaceURI === "http://www.w3.org/2002/xforms" && child.localName === "setvalue");
        if (!action) continue;
        const ref = action.getAttribute("ref")?.trim();
        const literal = action.getAttribute("value");
        if (!ref || literal === null || literal === "") {
          this.diagnostic("invalid-setvalue-action", `Trigger '${trigger.id}' requires direct xf:setvalue ref and non-empty value attributes.`);
          continue;
        }
        this.actions.set(trigger.id, Object.freeze({ ref, literal }));
      }
    }

    activate(detail) {
      if (detail?.kind !== "activate") return;
      const action = this.actions.get(detail.controlId);
      if (!action) return;
      const sequence = this.client.querySimplePath(action.ref);
      this.pending.set(sequence, action);
    }

    applyQuery(message) {
      const action = this.pending.get(message.sequence);
      if (!action) return;
      this.pending.delete(message.sequence);
      const nodeIds = Array.isArray(message.nodeIds) ? message.nodeIds : [];
      if (nodeIds.length !== 1) {
        this.diagnostic("setvalue-target-cardinality", `Setvalue ref '${action.ref}' resolved to ${nodeIds.length} nodes; exactly one target is required.`);
        return;
      }
      this.client.intent({ kind: "set-value", nodeId: nodeIds[0], value: action.literal });
    }

    diagnostic(code, message) {
      this.host.dispatchEvent(new CustomEvent("xforms-action-diagnostic", { detail: { code, message }, bubbles: true, composed: true }));
    }

    dispose() {
      this.host.removeEventListener("xforms-intent", this.onIntent);
      this.client.removeEventListener("simple-path-result", this.onQuery);
      this.pending.clear();
    }
  }

  root.SetValueActionError = SetValueActionError;
  root.XFormsSetValueActionBridge = XFormsSetValueActionBridge;
})();
