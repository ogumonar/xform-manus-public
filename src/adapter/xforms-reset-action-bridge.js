/* XForm Revival — constrained direct xf:reset action bridge. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const XFORMS_NAMESPACE = "http://www.w3.org/2002/xforms";
  const ACTION_ELEMENTS = new Set(["action", "setvalue", "insert", "delete", "setindex", "toggle", "setfocus", "dispatch", "rebuild", "recalculate", "revalidate", "refresh", "reset", "send", "load", "message"]);

  class ResetActionError extends Error {
    constructor(code, message) { super(message); this.name = "ResetActionError"; this.code = code; }
  }

  class XFormsResetActionBridge {
    static create({ host, client } = {}) {
      if (!host || !client?.reset) throw new ResetActionError("missing-reset-client", "Reset action bridge requires a host and an initialized worker client.");
      return new XFormsResetActionBridge(host, client);
    }

    constructor(host, client) {
      this.host = host;
      this.client = client;
      this.actions = new Set();
      this.onIntent = (event) => this.activate(event.detail);
      host.addEventListener("xforms-intent", this.onIntent);
      this.discover();
    }

    discover() {
      const sourceTriggers = Array.from(this.host.querySelectorAll("xf\\:trigger[id]"));
      const adaptedTriggers = Array.from(this.host.querySelectorAll("xforms-trigger[id]")).filter((trigger) =>
        Array.from(trigger.children).some((child) => child.localName === "template" && child.hasAttribute("data-xforms-action-declarations"))
      );
      for (const trigger of [...sourceTriggers, ...adaptedTriggers]) {
        const declarationTemplate = Array.from(trigger.children).find((child) => child.localName === "template" && child.hasAttribute("data-xforms-action-declarations"));
        const actionChildren = declarationTemplate ? Array.from(declarationTemplate.content.children) : Array.from(trigger.children);
        const actions = actionChildren.filter((child) => child.namespaceURI === XFORMS_NAMESPACE && ACTION_ELEMENTS.has(child.localName));
        if (!actions.length) continue;
        if (actions.length !== 1 || actions[0].localName !== "reset") {
          this.diagnostic("unsupported-reset-action-shape", `Trigger '${trigger.id}' must contain exactly one direct xf:reset action in this constrained bridge.`);
          continue;
        }
        this.actions.add(trigger.id);
      }
    }

    activate(detail) {
      if (detail?.kind !== "activate" || !this.actions.has(detail.controlId)) return;
      const sequence = this.client.reset();
      this.host.dispatchEvent(new CustomEvent("xforms-reset-applied", {
        detail: { controlId: detail.controlId, sequence }, bubbles: true, composed: true
      }));
    }

    diagnostic(code, message) {
      this.host.dispatchEvent(new CustomEvent("xforms-action-diagnostic", { detail: { code, message }, bubbles: true, composed: true }));
    }

    dispose() { this.host.removeEventListener("xforms-intent", this.onIntent); }
  }

  root.ResetActionError = ResetActionError;
  root.XFormsResetActionBridge = XFormsResetActionBridge;
})();
