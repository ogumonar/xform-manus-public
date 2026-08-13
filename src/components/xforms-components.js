/*
 * XForm Revival Web Components.
 *
 * Components are deliberately view-only: the browser integration layer supplies
 * a projection of engine-owned model state and components return typed intents.
 * They do not parse XForms markup, evaluate XPath, or retain XML instance data.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  let nextControlUid = 0;
  const CONTROL_SELECTOR = [
    "xforms-input", "xforms-secret", "xforms-textarea", "xforms-range",
    "xforms-output", "xforms-select", "xforms-select1", "xforms-trigger", "xforms-submit",
    "xforms-group", "xforms-switch", "xforms-case"
  ].join(",");
  const REF_CONTROL_SELECTOR = [
    "xforms-input", "xforms-secret", "xforms-textarea", "xforms-range",
    "xforms-output", "xforms-select", "xforms-select1"
  ].join(",");

  const DEFAULT_STATE = Object.freeze({
    value: "",
    relevant: true,
    readonly: false,
    required: false,
    valid: true,
    choices: [],
    label: "",
    hint: "",
    alert: "Invalid value"
  });

  class XFormsControlElement extends HTMLElement {
    static get observedAttributes() {
      return ["node-id", "label", "hint", "alert", "control-id"];
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.state = { ...DEFAULT_STATE };
      this.client = null;
      this.boundNodeId = null;
      this.uid = `xfr-control-${++nextControlUid}`;
    }

    connectedCallback() {
      this.render();
      this.bindClient(this.closest("xforms-host")?.engineClient || null);
    }

    disconnectedCallback() {
      this.unbindClient();
    }

    attributeChangedCallback() {
      if (this.isConnected) {
        this.bindClient(this.closest("xforms-host")?.engineClient || null);
        this.render();
      }
    }

    get nodeId() {
      const raw = this.getAttribute("node-id");
      if (raw === null || raw.trim() === "") return null;
      const parsed = Number(raw);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    get controlId() {
      return this.getAttribute("control-id") || this.id || this.uid;
    }

    bindClient(client) {
      const nodeId = this.nodeId;
      if (this.client === client && this.boundNodeId === nodeId) return;
      this.unbindClient();
      this.client = client;
      this.boundNodeId = nodeId;
      if (this.client && nodeId !== null) this.client.registerComponent(nodeId, this);
    }

    unbindClient() {
      if (this.client && this.boundNodeId !== null) this.client.unregisterComponent(this.boundNodeId, this);
      this.client = null;
      this.boundNodeId = null;
    }

    applyEnginePatch(patch = {}) {
      const statePatch = patch.state && typeof patch.state === "object" ? patch.state : extractStatePatch(patch);
      this.setControlState({ ...statePatch, version: patch.version });
    }

    setControlState(state = {}) {
      this.state = { ...this.state, ...state };
      this.render();
    }

    emitIntent(kind, extra = {}) {
      const detail = {
        kind,
        nodeId: this.nodeId,
        controlId: this.controlId,
        controlType: this.localName,
        ...extra
      };
      const accepted = this.dispatchEvent(new CustomEvent("xforms-intent", {
        detail,
        bubbles: true,
        composed: true,
        cancelable: true
      }));
      if (accepted && detail.nodeId !== null) this.client?.intent(detail);
      return detail;
    }

    get text() {
      return {
        label: this.state.label || this.getAttribute("label") || "",
        hint: this.state.hint || this.getAttribute("hint") || "",
        alert: this.state.alert || this.getAttribute("alert") || "Invalid value"
      };
    }

    get isRelevant() { return this.state.relevant !== false; }
    get isReadonly() { return this.state.readonly === true; }
    get isValid() { return this.state.valid !== false; }

    controlAttributes({ readonlyMode = "readonly", includeRequired = true } = {}) {
      const { hint, alert } = this.text;
      const describedBy = [];
      if (hint) describedBy.push(`${this.uid}-hint`);
      if (!this.isValid && alert) describedBy.push(`${this.uid}-alert`);
      const attributes = [
        `id="${this.uid}-native"`,
        `aria-invalid="${String(!this.isValid)}"`,
        `aria-readonly="${String(this.isReadonly)}"`
      ];
      if (describedBy.length) attributes.push(`aria-describedby="${describedBy.join(" ")}"`);
      if (includeRequired && this.state.required) {
        attributes.push("required", 'aria-required="true"');
      }
      if (this.isReadonly) attributes.push(readonlyMode === "disabled" ? "disabled" : "readonly");
      return attributes.join(" ");
    }

    shell(controlMarkup, { labelFor = `${this.uid}-native`, labelInside = false } = {}) {
      const { label, hint, alert } = this.text;
      this.hidden = !this.isRelevant;
      this.toggleAttribute("data-xforms-invalid", !this.isValid);
      this.toggleAttribute("data-xforms-readonly", this.isReadonly);
      this.toggleAttribute("data-xforms-required", this.state.required === true);
      const labelMarkup = !labelInside && label
        ? `<label part="label" for="${labelFor}">${escapeHtml(label)}</label>`
        : "";
      const hintMarkup = hint
        ? `<div id="${this.uid}-hint" part="hint" class="hint">${escapeHtml(hint)}</div>`
        : "";
      const alertMarkup = !this.isValid && alert
        ? `<div id="${this.uid}-alert" part="alert" class="alert" role="alert">${escapeHtml(alert)}</div>`
        : "";
      return `${this.style()}<div part="control" class="control">${labelMarkup}${controlMarkup}${hintMarkup}${alertMarkup}</div>`;
    }

    style() {
      return `<style>
        :host{display:block;margin:.5rem 0;color:inherit;font:inherit}
        :host([hidden]){display:none}
        .control{display:grid;gap:.35rem}
        label,[part="label"]{font-weight:600}
        input,textarea,select,button,output{box-sizing:border-box;max-width:100%;font:inherit}
        textarea{min-block-size:5rem;resize:vertical}
        .hint{color:CanvasText;opacity:.76;font-size:.9em}
        .alert{color:#b42318;font-size:.9em;font-weight:600}
        :host([data-xforms-invalid]) input,:host([data-xforms-invalid]) textarea,:host([data-xforms-invalid]) select{border-color:#b42318}
      </style>`;
    }
  }

  class XFormsInput extends XFormsControlElement {
    render() {
      const value = this.state.value ?? "";
      const markup = `<input type="text" value="${escapeHtml(value)}" ${this.controlAttributes()}>`;
      this.shadowRoot.innerHTML = this.shell(markup);
      const input = this.shadowRoot.querySelector("input");
      input.addEventListener("input", () => this.emitIntent("set-value", { value: input.value }));
    }
  }

  class XFormsSecret extends XFormsControlElement {
    render() {
      const value = this.state.value ?? "";
      const markup = `<input type="password" value="${escapeHtml(value)}" ${this.controlAttributes()}>`;
      this.shadowRoot.innerHTML = this.shell(markup);
      const input = this.shadowRoot.querySelector("input");
      input.addEventListener("input", () => this.emitIntent("set-value", { value: input.value }));
    }
  }

  class XFormsTextarea extends XFormsControlElement {
    render() {
      const value = this.state.value ?? "";
      const markup = `<textarea ${this.controlAttributes()}>${escapeHtml(value)}</textarea>`;
      this.shadowRoot.innerHTML = this.shell(markup);
      const textarea = this.shadowRoot.querySelector("textarea");
      textarea.addEventListener("input", () => this.emitIntent("set-value", { value: textarea.value }));
    }
  }

  class XFormsRange extends XFormsControlElement {
    render() {
      const value = this.state.value ?? "";
      const start = this.state.start ?? this.getAttribute("start") ?? "0";
      const end = this.state.end ?? this.getAttribute("end") ?? "100";
      const step = this.state.step ?? this.getAttribute("step") ?? "1";
      const markup = `<input type="range" min="${escapeHtml(start)}" max="${escapeHtml(end)}" step="${escapeHtml(step)}" value="${escapeHtml(value)}" ${this.controlAttributes({ readonlyMode: "disabled" })}>`;
      this.shadowRoot.innerHTML = this.shell(markup);
      const range = this.shadowRoot.querySelector("input");
      range.addEventListener("input", () => this.emitIntent("set-value", { value: range.value }));
      range.addEventListener("change", () => this.emitIntent("set-value", { value: range.value }));
    }
  }

  class XFormsOutput extends XFormsControlElement {
    render() {
      const markup = `<output ${this.controlAttributes({ includeRequired: false })}>${escapeHtml(this.state.value ?? "")}</output>`;
      this.shadowRoot.innerHTML = this.shell(markup);
    }
  }

  class XFormsSelect1 extends XFormsControlElement {
    render() {
      const value = String(this.state.value ?? "");
      const choices = normaliseChoices(this.state.choices);
      const options = choices.map((choice) => `<option value="${escapeHtml(choice.value)}" ${choice.value === value ? "selected" : ""} ${choice.disabled ? "disabled" : ""}>${escapeHtml(choice.label)}</option>`).join("");
      this.shadowRoot.innerHTML = this.shell(`<select ${this.controlAttributes({ readonlyMode: "disabled" })}>${options}</select>`);
      const select = this.shadowRoot.querySelector("select");
      select.addEventListener("change", () => this.emitIntent("set-value", { value: select.value }));
    }
  }

  class XFormsSelect extends XFormsControlElement {
    render() {
      const values = selectedValues(this.state.value);
      const choices = normaliseChoices(this.state.choices);
      const options = choices.map((choice) => `<option value="${escapeHtml(choice.value)}" ${values.has(choice.value) ? "selected" : ""} ${choice.disabled ? "disabled" : ""}>${escapeHtml(choice.label)}</option>`).join("");
      this.shadowRoot.innerHTML = this.shell(`<select multiple ${this.controlAttributes({ readonlyMode: "disabled" })}>${options}</select>`);
      const select = this.shadowRoot.querySelector("select");
      select.addEventListener("change", () => {
        const value = Array.from(select.selectedOptions, (option) => option.value);
        this.emitIntent("set-value", { value });
      });
    }
  }

  class XFormsActivationControl extends XFormsControlElement {
    activationKind() { return "activate"; }

    render() {
      const label = this.text.label || (this.activationKind() === "submit" ? "Submit" : "Continue");
      const attributes = this.controlAttributes({ readonlyMode: "disabled", includeRequired: false });
      this.shadowRoot.innerHTML = this.shell(`<button type="button" ${attributes}>${escapeHtml(label)}</button>`, { labelInside: true });
      this.shadowRoot.querySelector("button").addEventListener("click", () => this.emitIntent(this.activationKind()));
    }
  }

  class XFormsTrigger extends XFormsActivationControl {}

  class XFormsSubmit extends XFormsActivationControl {
    activationKind() { return "submit"; }
  }

  class XFormsGroup extends XFormsControlElement {
    render() {
      const { label, hint } = this.text;
      this.hidden = !this.isRelevant;
      const describedBy = hint ? ` aria-describedby="${this.uid}-hint"` : "";
      const legend = label ? `<legend part="label">${escapeHtml(label)}</legend>` : "";
      const hintMarkup = hint ? `<div id="${this.uid}-hint" part="hint" class="hint">${escapeHtml(hint)}</div>` : "";
      this.shadowRoot.innerHTML = `${this.style()}<fieldset part="group"${describedBy}>${legend}<slot></slot>${hintMarkup}</fieldset>`;
    }

    style() {
      return `${super.style()}<style>
        fieldset{display:grid;gap:.5rem;margin:0;padding:.75rem;border:1px solid color-mix(in srgb,CanvasText 25%,transparent);border-radius:.25rem}
        legend{padding:0 .25rem;font-weight:600}
      </style>`;
    }
  }

  class XFormsCase extends XFormsControlElement {
    static get observedAttributes() {
      return [...super.observedAttributes, "case-id"];
    }

    get caseId() {
      return this.getAttribute("case-id") || this.id || this.uid;
    }

    render() {
      const visible = this.isRelevant && this.state.selected === true;
      this.hidden = !visible;
      this.setAttribute("aria-hidden", String(!visible));
      this.shadowRoot.innerHTML = `${this.style()}<section part="case"><slot></slot></section>`;
    }
  }

  class XFormsSwitch extends XFormsControlElement {
    static get observedAttributes() {
      return [...super.observedAttributes, "selected-case"];
    }

    constructor() {
      super();
      this.caseObserver = null;
    }

    connectedCallback() {
      super.connectedCallback();
      this.caseObserver = new MutationObserver(() => this.syncCases());
      this.caseObserver.observe(this, { childList: true });
      this.syncCases();
    }

    disconnectedCallback() {
      this.caseObserver?.disconnect();
      this.caseObserver = null;
      super.disconnectedCallback();
    }

    render() {
      this.hidden = !this.isRelevant;
      this.shadowRoot.innerHTML = `${this.style()}<div part="switch"><slot></slot></div>`;
      this.syncCases();
    }

    syncCases() {
      const selectedCase = this.state.selectedCase ?? this.getAttribute("selected-case");
      for (const child of this.children) {
        if (child.localName === "xforms-case") child.setControlState({ selected: selectedCase !== null && child.caseId === selectedCase });
      }
    }
  }

  class XFormsRepeat extends XFormsControlElement {
    static get observedAttributes() {
      return [...super.observedAttributes, "repeat-id"];
    }

    constructor() {
      super();
      this.occurrences = new Map();
    }

    get repeatId() {
      return this.getAttribute("repeat-id") || this.id || this.controlId;
    }

    render() {
      this.hidden = !this.isRelevant;
      const items = Array.isArray(this.state.items) ? this.state.items : [];
      let container = this.shadowRoot.querySelector("[part=repeat]");
      if (!container) {
        this.shadowRoot.innerHTML = `${this.style()}<section part="repeat" role="list"></section>`;
        container = this.shadowRoot.querySelector("[part=repeat]");
      }
      const template = this.querySelector(":scope > template");
      const desired = new Set();
      items.forEach((item, offset) => {
        const key = String(item?.key ?? offset + 1);
        desired.add(key);
        let occurrence = this.occurrences.get(key);
        if (!occurrence) {
          occurrence = document.createElement("article");
          occurrence.setAttribute("part", "occurrence");
          occurrence.setAttribute("role", "listitem");
          occurrence.addEventListener("click", () => this.selectOccurrence(key));
          if (template) occurrence.append(template.content.cloneNode(true));
          else occurrence.append(document.createElement("span"));
          this.occurrences.set(key, occurrence);
        }
        occurrence.dataset.repeatKey = key;
        occurrence.dataset.repeatIndex = String(offset + 1);
        occurrence.setAttribute("aria-current", String(this.state.repeatIndex === offset + 1));
        occurrence.tabIndex = this.state.repeatIndex === offset + 1 ? 0 : -1;
        if (!template) occurrence.firstElementChild.textContent = String(item?.label ?? item?.value ?? key);
        container.append(occurrence);
      });
      for (const [key, occurrence] of this.occurrences) {
        if (!desired.has(key)) {
          occurrence.remove();
          this.occurrences.delete(key);
        }
      }
    }

    selectOccurrence(key) {
      const occurrence = this.occurrences.get(key);
      const repeatIndex = Number(occurrence?.dataset.repeatIndex || 0);
      if (!Number.isSafeInteger(repeatIndex) || repeatIndex < 1) return;
      this.setControlState({ repeatIndex });
      this.dispatchEvent(new CustomEvent("xforms-repeat-index", {
        detail: { repeatId: this.repeatId, repeatIndex, key }, bubbles: true, composed: true
      }));
    }

    style() {
      return `${super.style()}<style>[part=repeat]{display:grid;gap:.5rem}[part=occurrence]{cursor:pointer;padding:.5rem;border:1px solid color-mix(in srgb,CanvasText 20%,transparent);border-radius:.25rem}[part=occurrence][aria-current=true]{outline:2px solid Highlight;outline-offset:2px}</style>`;
    }
  }

  class XFormsHost extends HTMLElement {
    constructor() {
      super();
      this.engineClient = null;
      this.componentObserver = null;
      this.hydrationQueued = false;
      this.pendingControlRefBindings = new Map();
      this.actionBridge = null;
      this.setIndexActionBridge = null;
    }

    connectedCallback() {
      if (this.engineClient || this.hydrationQueued) return;
      this.hydrationQueued = true;
      queueMicrotask(() => {
        this.hydrationQueued = false;
        if (!this.isConnected || this.engineClient) return;
        this.initialize();
      });
    }

    initialize() {
      if (!root.XFormEngineClient) throw new Error("Load xform-engine-client.js before <xforms-host>.");
      this.engineClient = new root.XFormEngineClient({
        onDiagnostic: (...args) => this.dispatchEvent(new CustomEvent("xforms-diagnostic", { detail: args, bubbles: true, composed: true }))
      });
      this.engineClient.addEventListener("hydrated", (event) => {
        this.resolveDescendantControlRefs();
        this.dispatchEvent(new CustomEvent("xforms-ready", { detail: event.detail, bubbles: true, composed: true }));
      });
      this.engineClient.addEventListener("simple-path-result", (event) => this.applyControlRefResult(event.detail));
      this.engineClient.addEventListener("diagnostic", (event) => this.applyControlRefDiagnostic(event.detail));
      this.engineClient.addEventListener("patches", (event) => this.applyConstrainedRecalculation(event.detail));
      this.bindDescendantComponents();
      this.observeDescendantComponents();
      const configuredNodeCount = Number(this.getAttribute("node-count") || 0);
      const discoveredModel = this.hasAttribute("discover-model") ? discoverInlineModel(this, configuredNodeCount) : null;
      const discoveredInstance = discoveredModel?.instance ?? null;
      if (this.hasAttribute("enable-setvalue-actions")) this.actionBridge = createSetValueActionBridge(discoveredModel, this, this.engineClient);
      if (this.hasAttribute("enable-setindex-actions")) this.setIndexActionBridge = createSetIndexActionBridge(this);
      if (this.hasAttribute("project-repeats")) projectDiscoveredRepeats(discoveredModel, this);
      const nodeCount = discoveredInstance?.nodeCount ?? configuredNodeCount;
      const explicitDependencies = parseDependencies(this.getAttribute("dependencies"));
      const dependencies = mergeDependencies(explicitDependencies, this.hasAttribute("register-static-dependencies")
        ? extractStaticDependencies(discoveredModel, this)
        : []);
      const explicitInitialValues = parseJsonArray(this.getAttribute("initial-values"), "xforms-host initial-values");
      const explicitInitialModelItemFlags = parseJsonArray(this.getAttribute("initial-model-item-flags"), "xforms-host initial-model-item-flags");
      this.recalculator = this.hasAttribute("recalculate-calculates")
        ? createConstrainedRecalculator(discoveredModel, this)
        : null;
      const executed = this.hasAttribute("execute-initial-binds")
        ? executeInitialBinds(discoveredModel, this)
        : { initialValues: [], initialModelItemFlags: [] };
      this.engineClient.hydrate({
        nodeCount,
        dependencies,
        initialValues: mergeHydrationProjections(executed.initialValues, explicitInitialValues),
        initialModelItemFlags: mergeHydrationProjections(executed.initialModelItemFlags, explicitInitialModelItemFlags),
        inlineInstanceXml: discoveredInstance?.xml ?? null
      });
    }

    disconnectedCallback() {
      this.componentObserver?.disconnect();
      this.componentObserver = null;
      this.hydrationQueued = false;
      this.pendingControlRefBindings.clear();
      this.actionBridge?.dispose();
      this.actionBridge = null;
      this.setIndexActionBridge?.dispose();
      this.setIndexActionBridge = null;
      for (const component of this.querySelectorAll(CONTROL_SELECTOR)) component.bindClient?.(null);
      this.engineClient?.dispose();
      this.engineClient = null;
    }

    bindDescendantComponents() {
      for (const component of this.querySelectorAll(CONTROL_SELECTOR)) component.bindClient?.(this.engineClient);
    }

    isAutoControlBindingEnabled() {
      return this.hasAttribute("discover-model") && this.hasAttribute("bind-controls");
    }

    resolveDescendantControlRefs() {
      if (!this.isAutoControlBindingEnabled()) return;
      for (const component of this.querySelectorAll(REF_CONTROL_SELECTOR)) this.requestControlRefBinding(component);
    }

    requestControlRefBinding(component) {
      if (!this.isAutoControlBindingEnabled() || !this.engineClient || !component?.matches?.(REF_CONTROL_SELECTOR)) return;
      if (component.hasAttribute("node-id")) return;
      const ref = component.getAttribute("ref")?.trim();
      if (!ref || Array.from(this.pendingControlRefBindings.values()).some((pending) => pending.component === component)) return;
      const sequence = this.engineClient.querySimplePath(ref);
      this.pendingControlRefBindings.set(sequence, { component, ref });
    }

    applyConstrainedRecalculation(message) {
      if (!this.recalculator || !this.hasAttribute("recalculate-calculates")) return;
      try {
        this.recalculator.applyPatches(
          message.sequence,
          message.patches,
          (originSequence, values) => this.engineClient.submitCalculatedValues(originSequence, values),
          (originSequence, entries) => this.engineClient.submitResolvedModelItemState(originSequence, entries)
        );
      } catch (error) {
        this.dispatchEvent(new CustomEvent("xforms-recalculation-diagnostic", {
          detail: { code: error.code || "recalculation-failed", message: error.message }, bubbles: true, composed: true
        }));
        this.recalculator = null;
      }
    }

    applyControlRefResult(message) {
      const pending = this.pendingControlRefBindings.get(message.sequence);
      if (!pending) return;
      this.pendingControlRefBindings.delete(message.sequence);
      const { component, ref } = pending;
      if (!component.isConnected || component.closest("xforms-host") !== this || component.hasAttribute("node-id") || component.getAttribute("ref")?.trim() !== ref) return;
      const nodeIds = Array.isArray(message.nodeIds) ? message.nodeIds : [];
      if (nodeIds.length !== 1 || !Number.isSafeInteger(nodeIds[0]) || nodeIds[0] < 0) {
        this.dispatchControlBindingDiagnostic(component, ref, "ambiguous-control-ref", `Control ref '${ref}' resolved to ${nodeIds.length} nodes; exactly one target is required.`);
        return;
      }
      const nodeId = nodeIds[0];
      const projection = Array.isArray(message.projections)
        ? message.projections.find((candidate) => candidate?.nodeId === nodeId)
        : null;
      if (!projection?.state || !Number.isSafeInteger(projection.version)) {
        this.dispatchControlBindingDiagnostic(component, ref, "missing-control-projection", `Control ref '${ref}' resolved to node ${nodeId} without a valid immutable projection.`);
        return;
      }
      component.setAttribute("node-id", String(nodeId));
      component.bindClient(this.engineClient);
      component.applyEnginePatch(projection);
      this.dispatchEvent(new CustomEvent("xforms-control-bound", {
        detail: { component, controlId: component.controlId, ref, nodeId }, bubbles: true, composed: true
      }));
    }

    applyControlRefDiagnostic(message) {
      const pending = this.pendingControlRefBindings.get(message?.sequence);
      if (!pending) return;
      this.pendingControlRefBindings.delete(message.sequence);
      const { component, ref } = pending;
      this.dispatchControlBindingDiagnostic(component, ref, message.code || "control-ref-query-failed", message.message || `Control ref '${ref}' could not be resolved.`);
    }

    dispatchControlBindingDiagnostic(component, ref, code, message) {
      this.dispatchEvent(new CustomEvent("xforms-control-binding-diagnostic", {
        detail: { component, controlId: component.controlId, ref, code, message }, bubbles: true, composed: true
      }));
    }

    observeDescendantComponents() {
      this.componentObserver?.disconnect();
      this.componentObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) this.bindControlsWithin(node);
        }
      });
      this.componentObserver.observe(this, { childList: true, subtree: true });
    }

    bindControlsWithin(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const components = [
        ...(node.matches?.(CONTROL_SELECTOR) ? [node] : []),
        ...(node.querySelectorAll?.(CONTROL_SELECTOR) || [])
      ];
      for (const component of components) component.bindClient?.(this.engineClient);
      for (const component of components) this.requestControlRefBinding(component);
    }
  }

  function discoverInlineModel(host, configuredNodeCount) {
    if (!root.XFormsModelDiscovery?.discover) {
      throw new Error("Load xforms-model-discovery.js before using <xforms-host discover-model>.");
    }
    const discovery = root.XFormsModelDiscovery.discover(host);
    if (discovery.models.length !== 1) {
      throw new Error(`<xforms-host discover-model> requires exactly one discovered xf:model; found ${discovery.models.length}.`);
    }
    const [model] = discovery.models;
    if (model.inlineInstances.length !== 1) {
      throw new Error(`<xforms-host discover-model> requires exactly one inline xf:instance; found ${model.inlineInstances.length}.`);
    }
    const [instance] = model.inlineInstances;
    if (host.hasAttribute("node-count") && configuredNodeCount !== instance.nodeCount) {
      throw new Error(`<xforms-host> node-count ${configuredNodeCount} does not match discovered inline instance count ${instance.nodeCount}.`);
    }
    return Object.freeze({ instance, bindings: model.bindings });
  }

  function executeInitialBinds(discoveredModel, host) {
    if (!discoveredModel) throw new Error("<xforms-host execute-initial-binds> requires discover-model and one inline xf:instance.");
    if (!root.XFormsInitialBindExecutor?.execute) {
      throw new Error("Load xforms-bind-target-resolver.js, xforms-property-evaluator.js, and xforms-initial-bind-executor.js before using <xforms-host execute-initial-binds>.");
    }
    return root.XFormsInitialBindExecutor.execute({
      inlineInstanceXml: discoveredModel.instance.xml,
      bindings: discoveredModel.bindings
    });
  }

  function mergeHydrationProjections(generated, explicit) {
    const explicitNodeIds = new Set(explicit.map((entry) => entry?.nodeId));
    return [...generated.filter((entry) => !explicitNodeIds.has(entry.nodeId)), ...explicit];
  }

  function createSetIndexActionBridge(host) {
    if (!root.XFormsSetIndexActionBridge?.create) {
      throw new Error("Load xforms-setindex-action-bridge.js before using <xforms-host enable-setindex-actions>.");
    }
    return root.XFormsSetIndexActionBridge.create({ host });
  }

  function createSetValueActionBridge(discoveredModel, host, client) {
    if (!discoveredModel) throw new Error("<xforms-host enable-setvalue-actions> requires discover-model and one inline xf:instance.");
    if (!root.XFormsSetValueActionBridge?.create) {
      throw new Error("Load xforms-setvalue-action-bridge.js before using <xforms-host enable-setvalue-actions>.");
    }
    return root.XFormsSetValueActionBridge.create({ host, client, inlineInstanceXml: discoveredModel.instance.xml });
  }

  function projectDiscoveredRepeats(discoveredModel, host) {
    if (!discoveredModel) throw new Error("<xforms-host project-repeats> requires discover-model and one inline xf:instance.");
    if (!root.XFormsDiscoveredRepeatProjector?.project) {
      throw new Error("Load xforms-discovered-repeat-projector.js before using <xforms-host project-repeats>.");
    }
    for (const repeat of host.querySelectorAll("xforms-repeat[bind-id]")) {
      try {
        repeat.setControlState(root.XFormsDiscoveredRepeatProjector.project({
          inlineInstanceXml: discoveredModel.instance.xml,
          bindings: discoveredModel.bindings,
          bindId: repeat.getAttribute("bind-id")
        }));
      } catch (error) {
        host.dispatchEvent(new CustomEvent("xforms-repeat-projection-diagnostic", {
          detail: { repeat, bindId: repeat.getAttribute("bind-id"), code: error.code || "repeat-projection-failed", message: error.message }, bubbles: true, composed: true
        }));
      }
    }
  }

  function createConstrainedRecalculator(discoveredModel, host) {
    if (!host?.hasAttribute("register-static-dependencies")) throw new Error("<xforms-host recalculate-calculates> requires register-static-dependencies.");
    if (!discoveredModel) throw new Error("<xforms-host recalculate-calculates> requires discover-model and one inline xf:instance.");
    if (!root.XFormsConstrainedRecalculator?.create) {
      throw new Error("Load xforms-constrained-recalculator.js before using <xforms-host recalculate-calculates>.");
    }
    return root.XFormsConstrainedRecalculator.create({ inlineInstanceXml: discoveredModel.instance.xml, bindings: discoveredModel.bindings });
  }

  function mergeDependencies(explicit, extracted) {
    const edges = new Map();
    for (const edge of [...explicit, ...extracted]) edges.set(`${edge.source}:${edge.dependent}`, edge);
    return [...edges.values()];
  }

  function extractStaticDependencies(discoveredModel, host) {
    if (!discoveredModel) throw new Error("<xforms-host register-static-dependencies> requires discover-model and one inline xf:instance.");
    if (!root.XFormsBindTargetResolver?.resolve || !root.XFormsStaticDependencyExtractor?.extract) {
      throw new Error("Load xforms-bind-target-resolver.js and xforms-static-dependency-extractor.js before using <xforms-host register-static-dependencies>.");
    }
    const instanceDocument = new DOMParser().parseFromString(discoveredModel.instance.xml, "application/xml");
    const resolvedBindings = root.XFormsBindTargetResolver.resolve({ instanceDocument, bindings: discoveredModel.bindings });
    const extracted = root.XFormsStaticDependencyExtractor.extract({ instanceDocument, bindings: discoveredModel.bindings, resolvedBindings });
    if (extracted.diagnostics.length) {
      host.dispatchEvent(new CustomEvent("xforms-static-dependency-diagnostic", {
        detail: extracted.diagnostics, bubbles: true, composed: true
      }));
      return [];
    }
    return extracted.edges;
  }

  function extractStatePatch(patch) {
    const knownKeys = [
      "value", "relevant", "readonly", "required", "valid", "choices", "label", "hint", "alert", "start", "end", "step"
    ];
    return Object.fromEntries(knownKeys.filter((key) => Object.hasOwn(patch, key)).map((key) => [key, patch[key]]));
  }

  function normaliseChoices(choices) {
    if (!Array.isArray(choices)) return [];
    return choices.map((choice) => ({
      value: String(choice?.value ?? ""),
      label: String(choice?.label ?? choice?.value ?? ""),
      disabled: choice?.disabled === true
    }));
  }

  function selectedValues(value) {
    if (Array.isArray(value)) return new Set(value.map((item) => String(item)));
    return value === null || value === undefined || value === "" ? new Set() : new Set([String(value)]);
  }

  function parseDependencies(value) {
    return parseJsonArray(value, "xforms-host dependencies");
  }

  function parseJsonArray(value, attributeName) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("must be an array");
      return parsed;
    } catch (error) {
      throw new Error(`${attributeName} must be JSON: ${error.message}`);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  const definitions = {
    "xforms-host": XFormsHost,
    "xforms-input": XFormsInput,
    "xforms-secret": XFormsSecret,
    "xforms-textarea": XFormsTextarea,
    "xforms-range": XFormsRange,
    "xforms-output": XFormsOutput,
    "xforms-select": XFormsSelect,
    "xforms-select1": XFormsSelect1,
    "xforms-trigger": XFormsTrigger,
    "xforms-submit": XFormsSubmit,
    "xforms-group": XFormsGroup,
    "xforms-switch": XFormsSwitch,
    "xforms-case": XFormsCase,
    "xforms-repeat": XFormsRepeat
  };
  for (const [name, constructor] of Object.entries(definitions)) {
    if (!customElements.get(name)) customElements.define(name, constructor);
  }

  Object.assign(root, {
    XFormsControlElement,
    XFormsHost,
    XFormsInput,
    XFormsSecret,
    XFormsTextarea,
    XFormsRange,
    XFormsOutput,
    XFormsSelect,
    XFormsSelect1,
    XFormsTrigger,
    XFormsSubmit,
    XFormsGroup,
    XFormsSwitch,
    XFormsCase,
    XFormsRepeat
  });
})();
