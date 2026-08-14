/* XForm Revival — constrained direct xf:message action bridge. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const XFORMS_NAMESPACE = "http://www.w3.org/2002/xforms";
  const ACTION_ELEMENTS = new Set(["action", "setvalue", "insert", "delete", "setindex", "toggle", "setfocus", "dispatch", "rebuild", "recalculate", "revalidate", "refresh", "reset", "send", "load", "message"]);

  class MessageActionError extends Error {
    constructor(code, message) { super(message); this.name = "MessageActionError"; this.code = code; }
  }

  class XFormsMessageActionBridge {
    static create({ host } = {}) {
      if (!host) throw new MessageActionError("missing-action-host", "Message action bridge requires a host.");
      return new XFormsMessageActionBridge(host);
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
        const actions = Array.from(trigger.children).filter((child) => child.namespaceURI === XFORMS_NAMESPACE && ACTION_ELEMENTS.has(child.localName));
        if (!actions.length) continue;
        if (actions.length !== 1 || actions[0].localName !== "message") {
          this.diagnostic("unsupported-message-action-shape", `Trigger '${trigger.id}' must contain exactly one direct xf:message action in this constrained bridge.`);
          continue;
        }
        const message = actions[0].textContent.trim();
        if (!message) {
          this.diagnostic("invalid-message-action", `Trigger '${trigger.id}' requires non-empty xf:message text content.`);
          continue;
        }
        const level = actions[0].getAttribute("level")?.trim() || "modal";
        this.actions.set(trigger.id, Object.freeze({ message, level }));
      }
    }

    activate(intent) {
      if (intent?.kind !== "activate") return;
      const action = this.actions.get(intent.controlId);
      if (!action) return;
      this.host.dispatchEvent(new CustomEvent("xforms-message", {
        detail: Object.freeze({ originControlId: intent.controlId, message: action.message, level: action.level }), bubbles: true, composed: true
      }));
    }

    diagnostic(code, message) {
      this.host.dispatchEvent(new CustomEvent("xforms-action-diagnostic", { detail: { code, message }, bubbles: true, composed: true }));
    }

    dispose() { this.host.removeEventListener("xforms-intent", this.onIntent); }
  }

  root.MessageActionError = MessageActionError;
  root.XFormsMessageActionBridge = XFormsMessageActionBridge;
})();
