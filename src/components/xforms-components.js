/*
 * Generic XForms Web Components.
 * These controls project worker-owned model state and emit intents; they never
 * retain authoritative XML values or dependency state.
 */
(() => {
  "use strict";

  class XFormsControlElement extends HTMLElement {
    static get observedAttributes() { return ["node-id", "label"]; }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.state = { relevant: true, readonly: false, required: false, valid: true, value: "" };
      this.client = null;
    }

    connectedCallback() {
      this.render();
      this.client = this.closest("xforms-host")?.engineClient || null;
      if (this.client && this.nodeId !== null) this.client.registerComponent(this.nodeId, this);
    }

    disconnectedCallback() {
      if (this.client && this.nodeId !== null) this.client.unregisterComponent(this.nodeId, this);
    }

    get nodeId() {
      const raw = this.getAttribute("node-id");
      return raw === null ? null : Number(raw);
    }

    applyEnginePatch(patch) {
      this.state = { ...this.state, version: patch.version };
      this.render();
    }

    setControlState(state) {
      this.state = { ...this.state, ...state };
      this.render();
    }

    intent(kind, extra = {}) {
      if (this.nodeId === null) return;
      this.client?.intent({ kind, nodeId: this.nodeId, ...extra });
    }

    style() {
      return `<style>:host{display:block;margin:.5rem 0}:host([hidden]){display:none}label{display:grid;gap:.35rem;font:inherit}small{color:#5f6368}.invalid{color:#b42318}input,select,button,output{font:inherit}</style>`;
    }
  }

  class XFormsInput extends XFormsControlElement {
    render() {
      const { value, readonly, required, relevant, valid } = this.state;
      this.hidden = !relevant;
      const label = this.getAttribute("label") || "";
      this.shadowRoot.innerHTML = `${this.style()}<label>${label}<input aria-invalid="${!valid}" ${readonly ? "readonly" : ""} ${required ? "required" : ""} value="${escapeHtml(value)}"></label>${valid ? "" : '<small class="invalid">Invalid value</small>'}`;
      const input = this.shadowRoot.querySelector("input");
      input.addEventListener("input", () => this.intent("set-value", { value: input.value }));
    }
  }

  class XFormsOutput extends XFormsControlElement {
    render() {
      this.hidden = !this.state.relevant;
      const label = this.getAttribute("label") || "";
      this.shadowRoot.innerHTML = `${this.style()}<label>${label}<output>${escapeHtml(this.state.value)}</output></label>`;
    }
  }

  class XFormsTrigger extends XFormsControlElement {
    render() {
      this.hidden = !this.state.relevant;
      const label = this.getAttribute("label") || "Continue";
      this.shadowRoot.innerHTML = `${this.style()}<button type="button">${escapeHtml(label)}</button>`;
      this.shadowRoot.querySelector("button").addEventListener("click", () => this.intent("activate"));
    }
  }

  class XFormsSelect extends XFormsControlElement {
    render() {
      const { value, choices = [], readonly, relevant } = this.state;
      this.hidden = !relevant;
      const label = this.getAttribute("label") || "";
      const options = choices.map((choice) => `<option value="${escapeHtml(choice.value)}" ${choice.value === value ? "selected" : ""}>${escapeHtml(choice.label)}</option>`).join("");
      this.shadowRoot.innerHTML = `${this.style()}<label>${label}<select ${readonly ? "disabled" : ""}>${options}</select></label>`;
      this.shadowRoot.querySelector("select").addEventListener("change", (event) => this.intent("set-value", { value: event.target.value }));
    }
  }

  class XFormsHost extends HTMLElement {
    constructor() {
      super();
      this.engineClient = null;
    }

    async connectedCallback() {
      if (!globalThis.XFormRevival?.XFormEngineClient) throw new Error("Load xform-engine-client.js before <xforms-host>.");
      this.engineClient = new globalThis.XFormRevival.XFormEngineClient({
        onDiagnostic: (...args) => this.dispatchEvent(new CustomEvent("xforms-diagnostic", { detail: args }))
      });
      const nodeCount = Number(this.getAttribute("node-count") || 0);
      const dependencies = parseDependencies(this.getAttribute("dependencies"));
      this.engineClient.addEventListener("hydrated", (event) => this.dispatchEvent(new CustomEvent("xforms-ready", { detail: event.detail })));
      this.engineClient.hydrate({ nodeCount, dependencies });
    }

    disconnectedCallback() { this.engineClient?.dispose(); }
  }

  function parseDependencies(value) {
    if (!value) return [];
    try { return JSON.parse(value); } catch { throw new Error("xforms-host dependencies must be JSON."); }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  customElements.define("xforms-host", XFormsHost);
  customElements.define("xforms-input", XFormsInput);
  customElements.define("xforms-output", XFormsOutput);
  customElements.define("xforms-trigger", XFormsTrigger);
  customElements.define("xforms-select", XFormsSelect);
})();
