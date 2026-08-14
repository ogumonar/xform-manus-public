/* XForm Revival — constrained presentation-only direct xf:toggle action bridge. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};

  class ToggleActionError extends Error {
    constructor(code, message) { super(message); this.name = "ToggleActionError"; this.code = code; }
  }

  class XFormsToggleActionBridge {
    static create({ host } = {}) {
      if (!host) throw new ToggleActionError("missing-action-host", "Toggle action bridge requires a host.");
      return new XFormsToggleActionBridge(host);
    }

    constructor(host) {
      this.host = host;
      this.actions = new Map();
      this.onIntent = (event) => this.activate(event.detail);
      host.addEventListener("xforms-intent", this.onIntent);
      this.discover();
    }

    discover() {
      for (const trigger of this.host.querySelectorAll("xf\\:trigger[id]")) {
        const action = Array.from(trigger.children).find((child) => child.namespaceURI === "http://www.w3.org/2002/xforms" && child.localName === "toggle");
        if (!action) continue;
        const caseId = action.getAttribute("case")?.trim();
        if (!caseId) {
          this.diagnostic("invalid-toggle-action", `Trigger '${trigger.id}' requires a direct xf:toggle case attribute.`);
          continue;
        }
        this.actions.set(trigger.id, Object.freeze({ caseId }));
      }
    }

    activate(detail) {
      if (detail?.kind !== "activate") return;
      const action = this.actions.get(detail.controlId);
      if (!action) return;
      const targetCase = Array.from(this.host.querySelectorAll("xforms-case")).find((element) => element.caseId === action.caseId);
      const switchElement = targetCase?.closest("xforms-switch");
      if (!targetCase || !switchElement) {
        this.diagnostic("toggle-case-not-found", `Toggle case '${action.caseId}' is not in an xforms-switch within this host.`);
        return;
      }
      switchElement.setControlState({ selectedCase: action.caseId });
      this.host.dispatchEvent(new CustomEvent("xforms-toggle-applied", {
        detail: { switchId: switchElement.id || switchElement.uid, caseId: action.caseId }, bubbles: true, composed: true
      }));
    }

    diagnostic(code, message) {
      this.host.dispatchEvent(new CustomEvent("xforms-action-diagnostic", { detail: { code, message }, bubbles: true, composed: true }));
    }

    dispose() { this.host.removeEventListener("xforms-intent", this.onIntent); }
  }

  root.ToggleActionError = ToggleActionError;
  root.XFormsToggleActionBridge = XFormsToggleActionBridge;
})();
