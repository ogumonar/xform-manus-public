/* XForm Revival — constrained direct xf:dispatch action bridge. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const XFORMS_NAMESPACE = "http://www.w3.org/2002/xforms";
  const ACTION_ELEMENTS = new Set(["action", "setvalue", "insert", "delete", "setindex", "toggle", "setfocus", "dispatch", "rebuild", "recalculate", "revalidate", "refresh", "reset", "send", "load", "message"]);

  class DispatchActionError extends Error {
    constructor(code, message) { super(message); this.name = "DispatchActionError"; this.code = code; }
  }

  class XFormsDispatchActionBridge {
    static create({ host } = {}) {
      if (!host) throw new DispatchActionError("missing-action-host", "Dispatch action bridge requires a host.");
      return new XFormsDispatchActionBridge(host);
    }

    constructor(host) {
      this.host = host;
      this.actions = new Map();
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
        if (actions.length !== 1 || actions[0].localName !== "dispatch") {
          this.diagnostic("unsupported-dispatch-action-shape", `Trigger '${trigger.id}' must contain exactly one direct xf:dispatch action in this constrained bridge.`);
          continue;
        }
        const name = actions[0].getAttribute("name")?.trim();
        const targetId = actions[0].getAttribute("targetid")?.trim();
        if (!name || !targetId) {
          this.diagnostic("invalid-dispatch-action", `Trigger '${trigger.id}' requires non-empty xf:dispatch name and targetid attributes.`);
          continue;
        }
        this.actions.set(trigger.id, Object.freeze({ name, targetId }));
      }
    }

    activate(intent) {
      if (intent?.kind !== "activate") return;
      const action = this.actions.get(intent.controlId);
      if (!action) return;
      const target = this.host.ownerDocument.getElementById(action.targetId);
      if (!target || target.closest("xforms-host") !== this.host || !customElements.get(target.localName)) {
        this.diagnostic("dispatch-target-not-found", `Dispatch target '${action.targetId}' is not an in-host XForms component.`);
        return;
      }
      const detail = Object.freeze({ originControlId: intent.controlId, targetId: action.targetId });
      target.dispatchEvent(new CustomEvent(action.name, { detail, bubbles: true, composed: true, cancelable: false }));
      this.host.dispatchEvent(new CustomEvent("xforms-dispatch-applied", {
        detail: Object.freeze({ ...detail, eventName: action.name }), bubbles: true, composed: true
      }));
    }

    diagnostic(code, message) {
      this.host.dispatchEvent(new CustomEvent("xforms-action-diagnostic", { detail: { code, message }, bubbles: true, composed: true }));
    }

    dispose() { this.host.removeEventListener("xforms-intent", this.onIntent); }
  }

  root.DispatchActionError = DispatchActionError;
  root.XFormsDispatchActionBridge = XFormsDispatchActionBridge;
})();
