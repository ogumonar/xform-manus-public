/* XForm Revival — constrained presentation-only direct xf:setfocus action bridge. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};

  class SetFocusActionError extends Error {
    constructor(code, message) { super(message); this.name = "SetFocusActionError"; this.code = code; }
  }

  class XFormsSetFocusActionBridge {
    static create({ host } = {}) {
      if (!host) throw new SetFocusActionError("missing-action-host", "Setfocus action bridge requires a host.");
      return new XFormsSetFocusActionBridge(host);
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
        const action = Array.from(trigger.children).find((child) => child.namespaceURI === "http://www.w3.org/2002/xforms" && child.localName === "setfocus");
        if (!action) continue;
        const controlId = action.getAttribute("control")?.trim();
        if (!controlId) {
          this.diagnostic("invalid-setfocus-action", `Trigger '${trigger.id}' requires a direct xf:setfocus control attribute.`);
          continue;
        }
        this.actions.set(trigger.id, Object.freeze({ controlId }));
      }
    }

    activate(detail) {
      if (detail?.kind !== "activate") return;
      const action = this.actions.get(detail.controlId);
      if (!action) return;
      const target = Array.from(this.host.querySelectorAll("xforms-input,xforms-secret,xforms-textarea,xforms-range,xforms-select,xforms-select1,xforms-trigger,xforms-submit")).find((element) => element.id === action.controlId);
      if (!target || typeof target.focus !== "function") {
        this.diagnostic("setfocus-control-not-found", `Setfocus control '${action.controlId}' is not a focusable XForms component within this host.`);
        return;
      }
      target.focus();
      this.host.dispatchEvent(new CustomEvent("xforms-setfocus-applied", {
        detail: { controlId: action.controlId }, bubbles: true, composed: true
      }));
    }

    diagnostic(code, message) {
      this.host.dispatchEvent(new CustomEvent("xforms-action-diagnostic", { detail: { code, message }, bubbles: true, composed: true }));
    }

    dispose() { this.host.removeEventListener("xforms-intent", this.onIntent); }
  }

  root.SetFocusActionError = SetFocusActionError;
  root.XFormsSetFocusActionBridge = XFormsSetFocusActionBridge;
})();
