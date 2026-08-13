/*
 * XForm Revival 0.1.0
 * A deliberately bounded, standards-oriented XForms 1.1 runtime for modern browsers.
 * It uses native DOM, XPath 1.0, XMLSerializer, DOMParser, Fetch, and WebExtension
 * content-script injection. It never evaluates author-provided JavaScript.
 */
(() => {
  "use strict";

  const XF_NS = "http://www.w3.org/2002/xforms";
  const XML_NS = "http://www.w3.org/XML/1998/namespace";
  const XSD_NS = "http://www.w3.org/2001/XMLSchema";
  const CONTROL_NAMES = new Set([
    "input", "secret", "textarea", "output", "range", "trigger", "submit",
    "select", "select1", "group", "switch", "case", "repeat"
  ]);
  const ACTION_NAMES = new Set([
    "action", "setvalue", "toggle", "setfocus", "reset", "recalculate",
    "revalidate", "refresh", "rebuild", "send", "message", "dispatch", "load"
  ]);

  const cssEscape = (value) => {
    if (globalThis.CSS && typeof CSS.escape === "function") return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };

  const normalName = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    const raw = String(element.localName || element.tagName || "").toLowerCase();
    return raw.includes(":") ? raw.split(":").pop() : raw;
  };

  const isXForms = (element, expected) => {
    const name = normalName(element);
    const namespaced = element?.namespaceURI === XF_NS;
    const prefixed = /^xf:/i.test(element?.tagName || "") || /^xf:/i.test(element?.localName || "");
    return (namespaced || prefixed) && (!expected || name === expected);
  };

  const xformsElements = (root, expected) => {
    if (!root) return [];
    const candidates = [];
    if (root.nodeType === Node.ELEMENT_NODE && isXForms(root, expected)) candidates.push(root);
    for (const element of root.getElementsByTagName?.("*") || []) {
      if (isXForms(element, expected)) candidates.push(element);
    }
    return candidates;
  };

  const directXForms = (element, expected) =>
    Array.from(element?.children || []).filter((child) => isXForms(child, expected));

  const textOf = (element) => (element?.textContent || "").trim();
  const nodeText = (node) => node?.textContent ?? "";

  function splitArguments(source) {
    const values = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      } else if (char === "," && depth === 0) {
        values.push(source.slice(start, index).trim());
        start = index + 1;
      }
    }
    values.push(source.slice(start).trim());
    return values;
  }

  function boolFromResult(result) {
    switch (result.resultType) {
      case XPathResult.BOOLEAN_TYPE:
        return result.booleanValue;
      case XPathResult.NUMBER_TYPE:
        return Boolean(result.numberValue) && !Number.isNaN(result.numberValue);
      case XPathResult.STRING_TYPE:
        return result.stringValue.length > 0;
      case XPathResult.UNORDERED_NODE_ITERATOR_TYPE:
      case XPathResult.ORDERED_NODE_ITERATOR_TYPE:
      case XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE:
      case XPathResult.ORDERED_NODE_SNAPSHOT_TYPE:
        return result.snapshotLength === undefined ? Boolean(result.iterateNext()) : result.snapshotLength > 0;
      default:
        return false;
    }
  }

  class XFormEngine {
    constructor(pageDocument) {
      this.document = pageDocument;
      this.instances = new Map();
      this.initialInstances = new Map();
      this.bindsById = new Map();
      this.binds = [];
      this.submissions = new Map();
      this.controls = [];
      this.validity = new WeakMap();
      this.nodeContexts = new WeakMap();
      this.renderedRepeats = new WeakSet();
      this.status = null;
      this.sequence = 0;
      this.initialized = false;
    }

    hasXForms() {
      return xformsElements(this.document, "model").length > 0 ||
        xformsElements(this.document).some((element) => CONTROL_NAMES.has(normalName(element)));
    }

    async init() {
      if (this.initialized || !this.hasXForms()) return false;
      this.initialized = true;
      const models = xformsElements(this.document, "model");
      if (!models.length) {
        this.report("An XForms control was detected, but no xf:model was found.", "error");
        return false;
      }

      for (const model of models) {
        model.classList.add("xfr-model");
        await this.loadModel(model);
      }
      this.recalculate();
      this.revalidate();
      this.renderTree(this.document.body || this.document.documentElement, null);
      this.refresh();
      this.document.documentElement.dataset.xformRevival = "ready";
      this.dispatch(this.document, "xforms-ready", { engine: "XForm Revival" });
      return true;
    }

    async loadModel(model) {
      for (const instanceElement of directXForms(model, "instance")) {
        const id = instanceElement.getAttribute("id") || `default-${this.instances.size + 1}`;
        try {
          const instance = await this.readInstance(instanceElement);
          if (!instance?.documentElement) throw new Error("The instance has no XML root element.");
          this.instances.set(id, instance);
          this.initialInstances.set(id, new XMLSerializer().serializeToString(instance));
        } catch (error) {
          this.report(`Unable to load instance '${id}': ${error.message}`, "error");
        }
      }

      for (const bind of xformsElements(model, "bind")) {
        this.binds.push(bind);
        if (bind.id) this.bindsById.set(bind.id, bind);
      }
      for (const submission of directXForms(model, "submission")) {
        const id = submission.getAttribute("id") || `submission-${this.submissions.size + 1}`;
        this.submissions.set(id, submission);
      }
    }

    async readInstance(instanceElement) {
      const external = instanceElement.getAttribute("src") || instanceElement.getAttribute("resource");
      if (external) {
        const resource = this.safeSameOriginUrl(external);
        const response = await fetch(resource.href, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${resource.href}`);
        return this.parseXml(await response.text());
      }
      const root = Array.from(instanceElement.children).find((child) => !isXForms(child));
      if (!root) throw new Error("No inline instance data was supplied.");
      return this.cloneInlineInstance(root);
    }

    cloneInlineInstance(root) {
      const xml = document.implementation.createDocument(null, null);
      const htmlNamespace = "http://www.w3.org/1999/xhtml";
      const copy = (source, targetDocument) => {
        const hasExplicitDefaultNamespace = source.hasAttribute?.("xmlns");
        const namespace = source.namespaceURI === htmlNamespace && !hasExplicitDefaultNamespace
          ? null
          : source.namespaceURI;
        const target = targetDocument.createElementNS(namespace, source.localName || source.nodeName);
        for (const attribute of Array.from(source.attributes || [])) {
          if (attribute.name === "xmlns" && namespace === null) continue;
          target.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
        }
        for (const child of Array.from(source.childNodes || [])) {
          if (child.nodeType === Node.ELEMENT_NODE) target.append(copy(child, targetDocument));
          else target.append(targetDocument.importNode(child, true));
        }
        return target;
      };
      xml.append(copy(root, xml));
      return xml;
    }

    parseXml(source) {
      const parsed = new DOMParser().parseFromString(source, "application/xml");
      if (parsed.querySelector("parsererror")) throw new Error("The supplied resource is not well-formed XML.");
      return parsed;
    }

    defaultInstance() {
      return this.instances.get("default") || this.instances.values().next().value || null;
    }

    instanceFor(element) {
      const explicit = element?.getAttribute?.("instance");
      return (explicit && this.instances.get(explicit)) || this.defaultInstance();
    }

    contextFor(element, fallback) {
      return this.nodeContexts.get(element) || fallback || this.instanceFor(element)?.documentElement || null;
    }

    namespaceResolver(context) {
      const pageRoot = this.document.documentElement;
      return (prefix) => {
        if (prefix === "xml") return XML_NS;
        if (prefix === "xf" || prefix === "xforms") return XF_NS;
        if (prefix === "xsd" || prefix === "xs") return XSD_NS;
        return context?.lookupNamespaceURI?.(prefix) || pageRoot?.lookupNamespaceURI?.(prefix) || null;
      };
    }

    xpath(expression, context, resultType = XPathResult.ANY_TYPE) {
      if (!context || !expression) return null;
      const doc = context.nodeType === Node.DOCUMENT_NODE ? context : context.ownerDocument;
      try {
        return doc.evaluate(expression, context, this.namespaceResolver(context), resultType, null);
      } catch (error) {
        this.report(`XPath '${expression}' could not be evaluated: ${error.message}`, "error");
        return null;
      }
    }

    xpathNodes(expression, context) {
      const result = this.xpath(expression, context, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
      if (!result) return [];
      const values = [];
      for (let index = 0; index < result.snapshotLength; index += 1) values.push(result.snapshotItem(index));
      return values;
    }

    xpathString(expression, context) {
      if (!expression) return "";
      const trimmed = expression.trim();
      const functional = trimmed.match(/^(if|choose)\((.*)\)$/s);
      if (functional) {
        const parts = splitArguments(functional[2]);
        if (parts.length === 3) return this.xpathBoolean(parts[0], context)
          ? this.xpathString(parts[1], context)
          : this.xpathString(parts[2], context);
      }
      const result = this.xpath(trimmed, context, XPathResult.STRING_TYPE);
      return result ? result.stringValue : "";
    }

    xpathBoolean(expression, context) {
      if (!expression) return false;
      const trimmed = expression.trim();
      const functional = trimmed.match(/^(if|choose)\((.*)\)$/s);
      if (functional) {
        const parts = splitArguments(functional[2]);
        if (parts.length === 3) return this.xpathBoolean(parts[0], context)
          ? this.xpathBoolean(parts[1], context)
          : this.xpathBoolean(parts[2], context);
      }
      const result = this.xpath(trimmed, context, XPathResult.BOOLEAN_TYPE);
      return result ? boolFromResult(result) : false;
    }

    bindingFor(element) {
      const bindId = element?.getAttribute?.("bind");
      return bindId ? this.bindsById.get(bindId) || null : null;
    }

    referenceFor(element) {
      const bind = this.bindingFor(element);
      return element?.getAttribute?.("nodeset") || element?.getAttribute?.("ref") ||
        bind?.getAttribute("nodeset") || bind?.getAttribute("ref") || ".";
    }

    resolveNodes(element, fallbackContext) {
      const context = this.contextFor(element, fallbackContext);
      return this.xpathNodes(this.referenceFor(element), context);
    }

    resolveFirstNode(element, fallbackContext) {
      return this.resolveNodes(element, fallbackContext)[0] || null;
    }

    propertiesFor(element, node) {
      const bind = this.bindingFor(element);
      const property = (name, defaultValue) => {
        const expression = bind?.getAttribute(name);
        return expression === null || expression === undefined || expression === ""
          ? defaultValue
          : this.xpathBoolean(expression, node);
      };
      const type = bind?.getAttribute("type") || "";
      return {
        relevant: property("relevant", true),
        readonly: property("readonly", false),
        required: property("required", false),
        valid: (node ? this.validity.get(node) : true) !== false,
        type
      };
    }

    recalculate() {
      for (let pass = 0; pass < 3; pass += 1) {
        for (const bind of this.binds) {
          const calculation = bind.getAttribute("calculate");
          if (!calculation) continue;
          for (const node of this.resolveNodes(bind, this.instanceFor(bind)?.documentElement)) {
            node.textContent = this.xpathString(calculation, node);
          }
        }
      }
    }

    revalidate() {
      for (const bind of this.binds) {
        const context = this.instanceFor(bind)?.documentElement;
        for (const node of this.resolveNodes(bind, context)) {
          const required = bind.hasAttribute("required") && this.xpathBoolean(bind.getAttribute("required"), node);
          const relevant = !bind.hasAttribute("relevant") || this.xpathBoolean(bind.getAttribute("relevant"), node);
          const constraint = !bind.hasAttribute("constraint") || this.xpathBoolean(bind.getAttribute("constraint"), node);
          const typeOk = this.matchesType(node.textContent, bind.getAttribute("type") || "");
          const nonEmpty = !required || node.textContent.trim().length > 0;
          this.validity.set(node, !relevant || (constraint && typeOk && nonEmpty));
        }
      }
    }

    matchesType(value, type) {
      const local = String(type || "").split(":").pop();
      if (!value || !local) return true;
      if (local === "boolean") return /^(true|false|0|1)$/i.test(value);
      if (local === "integer" || local === "int" || local === "long") return /^[+-]?\d+$/.test(value);
      if (local === "decimal" || local === "double" || local === "float") return /^[+-]?(?:\d+|\d*\.\d+)(?:[Ee][+-]?\d+)?$/.test(value);
      if (local === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value);
      if (local === "dateTime") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
      if (local === "time") return /^\d{2}:\d{2}/.test(value);
      if (local === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      return true;
    }

    renderTree(root, context) {
      const elements = xformsElements(root).filter((element) => CONTROL_NAMES.has(normalName(element)));
      for (const element of elements) {
        if (!element.isConnected || this.isModelDescendant(element)) continue;
        const name = normalName(element);
        const nodeContext = this.contextFor(element, context);
        if (name === "repeat") {
          this.renderRepeat(element, nodeContext);
        } else if (name === "group") {
          this.renderGroup(element, nodeContext);
        } else if (name === "switch") {
          this.renderSwitch(element, nodeContext);
        } else if (name === "case") {
          this.renderCase(element, nodeContext);
        } else {
          this.renderControl(element, nodeContext);
        }
      }
    }

    isModelDescendant(element) {
      let parent = element.parentElement;
      while (parent) {
        if (isXForms(parent, "model")) return true;
        parent = parent.parentElement;
      }
      return false;
    }

    labelFor(source) {
      return textOf(directXForms(source, "label")[0]) || source.getAttribute("label") || "";
    }

    hintFor(source) {
      return textOf(directXForms(source, "hint")[0]);
    }

    alertFor(source) {
      return textOf(directXForms(source, "alert")[0]) || "The value does not satisfy this field’s requirements.";
    }

    moveContent(source, destination, context, excluded = []) {
      const excludedSet = new Set(excluded);
      for (const child of Array.from(source.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE && excludedSet.has(normalName(child)) && isXForms(child)) continue;
        if (child.nodeType === Node.ELEMENT_NODE) this.nodeContexts.set(child, context);
        destination.append(child);
      }
    }

    renderGroup(source, context) {
      const fieldset = this.document.createElement("fieldset");
      fieldset.className = "xfr-group";
      const label = this.labelFor(source);
      if (label) {
        const legend = this.document.createElement("legend");
        legend.textContent = label;
        fieldset.append(legend);
      }
      this.moveContent(source, fieldset, context, ["label", "hint"]);
      const hint = this.hintFor(source);
      if (hint) fieldset.append(this.makeHint(hint));
      source.replaceWith(fieldset);
    }

    renderSwitch(source, context) {
      const wrapper = this.document.createElement("div");
      wrapper.className = "xfr-switch";
      if (source.id) wrapper.dataset.xfrSwitch = source.id;
      this.moveContent(source, wrapper, context, ["label", "hint"]);
      source.replaceWith(wrapper);
    }

    renderCase(source, context) {
      const wrapper = this.document.createElement("section");
      wrapper.className = "xfr-case";
      wrapper.dataset.xfrCase = source.id || `case-${++this.sequence}`;
      if (source.getAttribute("selected") !== "true") wrapper.hidden = true;
      this.moveContent(source, wrapper, context, ["label", "hint"]);
      source.replaceWith(wrapper);
    }

    renderRepeat(source, context) {
      if (this.renderedRepeats.has(source)) return;
      this.renderedRepeats.add(source);
      const wrapper = this.document.createElement("div");
      wrapper.className = "xfr-repeat";
      if (source.id) wrapper.dataset.xfrRepeat = source.id;
      const template = Array.from(source.childNodes).map((node) => node.cloneNode(true));
      const values = this.resolveNodes(source, context);
      if (!values.length) {
        const empty = this.document.createElement("p");
        empty.className = "xfr-hint";
        empty.textContent = "No items are available.";
        wrapper.append(empty);
      }
      for (const value of values) {
        const item = this.document.createElement("div");
        item.className = "xfr-repeat-item";
        for (const node of template) {
          const clone = node.cloneNode(true);
          if (clone.nodeType === Node.ELEMENT_NODE) this.nodeContexts.set(clone, value);
          item.append(clone);
        }
        wrapper.append(item);
      }
      source.replaceWith(wrapper);
      this.renderTree(wrapper, context);
    }

    renderControl(source, context) {
      const name = normalName(source);
      if (!new Set(["input", "secret", "textarea", "output", "range", "trigger", "submit", "select", "select1"]).has(name)) return;
      const wrapper = this.document.createElement("div");
      wrapper.className = "xfr-control";
      const uid = `xfr-${++this.sequence}`;
      const labelText = this.labelFor(source);
      let input;

      if (name === "output") {
        input = this.document.createElement("output");
        input.className = "xfr-output-value";
        input.id = uid;
      } else if (name === "textarea") {
        input = this.document.createElement("textarea");
        input.id = uid;
      } else if (name === "select" || name === "select1") {
        input = this.document.createElement("select");
        input.id = uid;
        if (name === "select") input.multiple = true;
        this.populateChoices(input, source);
      } else if (name === "trigger" || name === "submit") {
        input = this.document.createElement("button");
        input.type = "button";
        input.id = uid;
        input.textContent = labelText || (name === "submit" ? "Submit" : "Continue");
      } else {
        input = this.document.createElement("input");
        input.id = uid;
        input.type = name === "secret" ? "password" : name === "range" ? "range" : "text";
        if (name === "range") {
          input.min = source.getAttribute("start") || source.getAttribute("min") || "0";
          input.max = source.getAttribute("end") || source.getAttribute("max") || "100";
          input.step = source.getAttribute("step") || "1";
        }
      }

      if (labelText && name !== "trigger" && name !== "submit") {
        const label = this.document.createElement("label");
        label.htmlFor = uid;
        label.textContent = labelText;
        wrapper.append(label);
      }
      wrapper.append(input);
      const hint = this.hintFor(source);
      if (hint) wrapper.append(this.makeHint(hint));
      const alert = this.document.createElement("div");
      alert.className = "xfr-alert";
      alert.hidden = true;
      alert.textContent = this.alertFor(source);
      wrapper.append(alert);
      source.replaceWith(wrapper);

      const record = { source, context, node: null, name, wrapper, input, alert, uid };
      this.controls.push(record);
      if (!new Set(["output", "trigger", "submit"]).has(name)) {
        const eventName = name === "input" || name === "secret" || name === "textarea" || name === "range" ? "input" : "change";
        input.addEventListener(eventName, () => this.commit(record));
        if (eventName === "input") input.addEventListener("change", () => this.commit(record));
      } else if (name === "trigger" || name === "submit") {
        input.addEventListener("click", () => this.activate(record));
      }
    }

    populateChoices(select, source) {
      const items = xformsElements(source, "item");
      for (const item of items) {
        const option = this.document.createElement("option");
        option.value = textOf(directXForms(item, "value")[0]);
        option.textContent = textOf(directXForms(item, "label")[0]) || option.value;
        select.append(option);
      }
    }

    makeHint(text) {
      const hint = this.document.createElement("div");
      hint.className = "xfr-hint";
      hint.textContent = text;
      return hint;
    }

    selectedValue(record) {
      if (record.name === "select") return Array.from(record.input.selectedOptions).map((option) => option.value).join(" ");
      return record.input.value;
    }

    commit(record) {
      const node = this.resolveFirstNode(record.source, record.context);
      if (!node || this.propertiesFor(record.source, node).readonly) return;
      node.textContent = this.selectedValue(record);
      record.node = node;
      this.dispatch(record.wrapper, "xforms-value-changed", { value: node.textContent });
      this.recalculate();
      this.revalidate();
      this.refresh();
    }

    refresh() {
      for (const record of this.controls) {
        const node = this.resolveFirstNode(record.source, record.context);
        record.node = node;
        const properties = this.propertiesFor(record.source, node);
        const value = node ? nodeText(node) : "";
        const rendered = record.input;
        const nonInteractive = new Set(["output", "trigger", "submit"]).has(record.name);
        if (record.name === "output") rendered.value = value;
        else if (record.name === "select") {
          const selected = new Set(value.trim() ? value.trim().split(/\s+/) : []);
          for (const option of rendered.options) option.selected = selected.has(option.value);
        } else if (!new Set(["trigger", "submit"]).has(record.name) && rendered.value !== value) rendered.value = value;
        rendered.disabled = !properties.relevant || properties.readonly || (!node && !nonInteractive);
        if (properties.required && !nonInteractive) rendered.required = true;
        else rendered.removeAttribute("required");
        record.wrapper.classList.toggle("xfr-irrelevant", !properties.relevant);
        record.wrapper.classList.toggle("xfr-readonly", properties.readonly);
        record.wrapper.classList.toggle("xfr-invalid", !properties.valid);
        record.wrapper.classList.toggle("xfr-required", properties.required);
        record.wrapper.hidden = !properties.relevant;
        record.alert.hidden = properties.valid || !properties.relevant;
        rendered.setAttribute("aria-invalid", String(!properties.valid));
      }
      this.normalizeSwitches();
      this.dispatch(this.document, "xforms-refresh", {});
    }

    normalizeSwitches() {
      for (const switchView of this.document.querySelectorAll(".xfr-switch")) {
        const cases = Array.from(switchView.querySelectorAll(":scope > .xfr-case"));
        if (cases.length && !cases.some((caseView) => !caseView.hidden)) cases[0].hidden = false;
      }
    }

    async activate(record) {
      const source = record.source;
      if (record.name === "submit") {
        const submissionId = source.getAttribute("submission") || source.getAttribute("bind");
        await this.submit(submissionId, record.context);
        return;
      }
      await this.executeChildren(source, record.context);
    }

    async executeChildren(parent, context) {
      const actions = Array.from(parent.children || []).filter((child) => ACTION_NAMES.has(normalName(child)) && isXForms(child));
      for (const action of actions) await this.executeAction(action, context);
    }

    async executeAction(action, context) {
      const name = normalName(action);
      const actionContext = this.contextFor(action, context);
      if (name === "action") {
        await this.executeChildren(action, actionContext);
      } else if (name === "setvalue") {
        const target = this.resolveFirstNode(action, actionContext);
        if (target) target.textContent = this.xpathString(action.getAttribute("value") || textOf(action), target);
      } else if (name === "toggle") {
        const caseId = action.getAttribute("case") || textOf(directXForms(action, "case")[0]);
        this.toggleCase(caseId);
      } else if (name === "setfocus") {
        const controlId = action.getAttribute("control") || textOf(directXForms(action, "control")[0]);
        this.controls.find((record) => record.source.id === controlId)?.input.focus();
      } else if (name === "reset") {
        this.reset();
      } else if (name === "recalculate") {
        this.recalculate();
      } else if (name === "revalidate") {
        this.revalidate();
      } else if (name === "refresh" || name === "rebuild") {
        this.refresh();
      } else if (name === "send") {
        await this.submit(action.getAttribute("submission") || action.getAttribute("id"), actionContext);
      } else if (name === "message") {
        this.report(action.getAttribute("value") || textOf(action) || "XForms message", "info");
      } else if (name === "dispatch") {
        const targetId = action.getAttribute("targetid") || textOf(directXForms(action, "targetid")[0]);
        const eventName = action.getAttribute("name") || textOf(directXForms(action, "name")[0]) || "xforms-dispatch";
        const target = this.document.getElementById(targetId) || this.document;
        this.dispatch(target, eventName, { source: "xform-revival" });
      } else if (name === "load") {
        const resource = action.getAttribute("resource") || action.getAttribute("href") || textOf(directXForms(action, "resource")[0]);
        if (resource) window.location.assign(this.safeSameOriginUrl(resource).href);
      }
      this.recalculate();
      this.revalidate();
      this.refresh();
    }

    toggleCase(caseId) {
      if (!caseId) return;
      const chosen = this.document.querySelector(`.xfr-case[data-xfr-case="${cssEscape(caseId)}"]`);
      if (!chosen) {
        this.report(`The toggle action references unknown case '${caseId}'.`, "error");
        return;
      }
      for (const candidate of chosen.parentElement.querySelectorAll(":scope > .xfr-case")) candidate.hidden = candidate !== chosen;
    }

    reset() {
      for (const [id, source] of this.initialInstances) {
        const restored = this.parseXml(source);
        const target = this.instances.get(id);
        if (target?.documentElement && restored.documentElement) this.copyXml(restored.documentElement, target.documentElement);
      }
      this.recalculate();
      this.revalidate();
      this.refresh();
      this.dispatch(this.document, "xforms-reset", {});
    }

    copyXml(source, target) {
      for (const attribute of Array.from(target.attributes || [])) target.removeAttribute(attribute.name);
      for (const attribute of Array.from(source.attributes || [])) target.setAttribute(attribute.name, attribute.value);
      while (target.firstChild) target.removeChild(target.firstChild);
      for (const child of Array.from(source.childNodes || [])) {
        target.append(target.ownerDocument.importNode(child, true));
      }
    }

    isValidForSubmission() {
      this.revalidate();
      return this.controls.every((record) => {
        const node = this.resolveFirstNode(record.source, record.context);
        const properties = this.propertiesFor(record.source, node);
        return !properties.relevant || properties.valid;
      });
    }

    async submit(id, context) {
      const submission = this.submissions.get(id) || (id ? this.document.getElementById(id) : null) || this.submissions.values().next().value;
      if (!submission || !isXForms(submission, "submission")) {
        this.report("No matching xf:submission is available for this submit control.", "error");
        return;
      }
      if (!this.isValidForSubmission() && submission.getAttribute("validate") !== "false") {
        this.refresh();
        this.report("The form contains invalid data and was not submitted.", "error");
        this.dispatch(submission, "xforms-submit-error", { reason: "validation-error" });
        return;
      }
      const resource = submission.getAttribute("resource") || submission.getAttribute("action") || this.document.location.href;
      let url;
      try {
        url = this.safeSameOriginUrl(resource);
      } catch (error) {
        this.report(error.message, "error");
        this.dispatch(submission, "xforms-submit-error", { reason: "security-error" });
        return;
      }
      const instanceId = submission.getAttribute("instance") || "default";
      const instance = this.instances.get(instanceId) || this.defaultInstance();
      if (!instance?.documentElement) {
        this.report("The submission has no XML instance to serialize.", "error");
        return;
      }
      const method = (submission.getAttribute("method") || "post").toLowerCase();
      const serialization = (submission.getAttribute("serialization") || "application/xml").toLowerCase();
      const options = { method: method === "get" ? "GET" : method.toUpperCase(), credentials: "same-origin", headers: {} };
      if (method === "get") {
        const query = new URLSearchParams(this.toUrlEncoded(instance.documentElement));
        for (const [key, value] of query) url.searchParams.append(key, value);
      } else if (serialization.includes("urlencoded")) {
        options.headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
        options.body = new URLSearchParams(this.toUrlEncoded(instance.documentElement)).toString();
      } else {
        options.headers["Content-Type"] = "application/xml;charset=UTF-8";
        options.body = new XMLSerializer().serializeToString(instance.documentElement);
      }
      this.dispatch(submission, "xforms-submit", { url: url.href, method: options.method });
      try {
        const response = await fetch(url.href, options);
        const responseText = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await this.applySubmissionResponse(submission, instance, responseText, response.url);
        this.dispatch(submission, "xforms-submit-done", { status: response.status, responseURL: response.url });
      } catch (error) {
        this.report(`Submission failed: ${error.message}`, "error");
        this.dispatch(submission, "xforms-submit-error", { reason: "resource-error", error: error.message });
      }
    }

    toUrlEncoded(root) {
      const result = [];
      const leaves = Array.from(root.getElementsByTagName("*")).filter((element) => element.children.length === 0);
      for (const leaf of leaves) result.push([leaf.localName, leaf.textContent]);
      if (!leaves.length) result.push([root.localName, root.textContent]);
      return result;
    }

    async applySubmissionResponse(submission, instance, responseText, responseUrl) {
      const replacement = submission.getAttribute("replace") || "none";
      if (replacement === "all") {
        window.location.assign(responseUrl);
        return;
      }
      if (replacement === "text") {
        const target = submission.getAttribute("targetref")
          ? this.xpathNodes(submission.getAttribute("targetref"), instance.documentElement)[0]
          : instance.documentElement;
        if (target) target.textContent = responseText;
      } else if (replacement === "instance") {
        const parsed = this.parseXml(responseText);
        if (parsed.documentElement) this.copyXml(parsed.documentElement, instance.documentElement);
      }
      this.recalculate();
      this.revalidate();
      this.refresh();
    }

    safeSameOriginUrl(raw) {
      const url = new URL(raw, this.document.location.href);
      if (url.origin !== this.document.location.origin) {
        throw new Error(`Blocked cross-origin XForms request to ${url.origin}. XForm Revival permits same-origin requests only.`);
      }
      return url;
    }

    dispatch(target, name, detail) {
      target.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
    }

    report(message, level = "info") {
      if (!this.status?.isConnected) {
        this.status = this.document.createElement("div");
        this.status.className = "xfr-status";
        const host = this.document.body || this.document.documentElement;
        host.prepend(this.status);
      }
      this.status.dataset.level = level;
      this.status.textContent = message;
      if (level === "error") console.warn("[XForm Revival]", message);
    }
  }

  const launch = () => {
    try {
      const engine = new XFormEngine(document);
      engine.init();
      globalThis.__xformRevival = engine;
    } catch (error) {
      console.error("[XForm Revival] startup failed", error);
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", launch, { once: true });
  else launch();
})();
