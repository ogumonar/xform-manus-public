/* XForm Revival — constrained presentation-only direct xf:setindex action bridge. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};

  class SetIndexActionError extends Error {
    constructor(code, message) { super(message); this.name = "SetIndexActionError"; this.code = code; }
  }

  class XFormsSetIndexActionBridge {
    static create({ host } = {}) {
      if (!host) throw new SetIndexActionError("missing-action-host", "Setindex action bridge requires a host.");
      return new XFormsSetIndexActionBridge(host);
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
        const action = Array.from(trigger.children).find((child) => child.namespaceURI === "http://www.w3.org/2002/xforms" && child.localName === "setindex");
        if (!action) continue;
        const repeatId = action.getAttribute("repeat")?.trim();
        const index = Number(action.getAttribute("index"));
        if (!repeatId || !Number.isSafeInteger(index) || index < 1) {
          this.diagnostic("invalid-setindex-action", `Trigger '${trigger.id}' requires direct xf:setindex repeat and positive integer index attributes.`);
          continue;
        }
        this.actions.set(trigger.id, Object.freeze({ repeatId, index }));
      }
    }

    activate(detail) {
      if (detail?.kind !== "activate") return;
      const action = this.actions.get(detail.controlId);
      if (!action) return;
      const repeat = Array.from(this.host.querySelectorAll("xforms-repeat")).find((element) => element.repeatId === action.repeatId);
      const itemCount = Array.isArray(repeat?.state?.items) ? repeat.state.items.length : 0;
      if (!repeat || action.index > itemCount) {
        this.diagnostic("setindex-out-of-range", `Setindex repeat '${action.repeatId}' has no projected occurrence ${action.index}.`);
        return;
      }
      repeat.setControlState({ repeatIndex: action.index });
      this.host.dispatchEvent(new CustomEvent("xforms-setindex-applied", {
        detail: { repeatId: action.repeatId, repeatIndex: action.index }, bubbles: true, composed: true
      }));
    }

    diagnostic(code, message) {
      this.host.dispatchEvent(new CustomEvent("xforms-action-diagnostic", { detail: { code, message }, bubbles: true, composed: true }));
    }

    dispose() { this.host.removeEventListener("xforms-intent", this.onIntent); }
  }

  root.SetIndexActionError = SetIndexActionError;
  root.XFormsSetIndexActionBridge = XFormsSetIndexActionBridge;
})();
