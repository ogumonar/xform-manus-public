/*
 * XForm Revival — bind-aware view/control layer.
 * Historical reference: extensions/xforms/nsXForms{Input,Output,Range,Select,
 * Select1,Repeat,Switch,Case,Group,Trigger,Label,Item,ItemSet,Value}Element.cpp
 * and resources/content/xforms/{widgets,input,selects,range}-xhtml.xml.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const { localName, isXForms, descendants, direct, text } = root.utils;
  const controls = new Set(["input", "secret", "textarea", "output", "range", "trigger", "submit", "select", "select1", "group", "switch", "case", "repeat"]);

  class ControlRenderer {
    constructor(pageDocument, model, report = () => {}) {
      this.document = pageDocument;
      this.model = model;
      this.report = report;
      this.actions = null;
      this.records = [];
      this.bySourceId = new Map();
      this.byDomId = new Map();
      this.repeatIndex = new Map();
      this.sequence = 0;
      this.document.addEventListener("xforms-refresh", (event) => {
        if (event.target === this.model.element) this.refresh();
      });
    }

    render() {
      this.renderTree(this.document.body || this.document.documentElement, null);
      this.refresh();
    }

    renderTree(rootElement, context) {
      const candidates = descendants(rootElement).filter((element) => controls.has(localName(element)));
      for (const source of candidates) {
        if (!source.isConnected || this.model.element.contains(source)) continue;
        const name = localName(source);
        const sourceContext = this.model.contextFor(source, context);
        if (name === "group") this.renderGroup(source, sourceContext);
        else if (name === "switch") this.renderSwitch(source, sourceContext);
        else if (name === "case") this.renderCase(source, sourceContext);
        else if (name === "repeat") this.renderRepeat(source, sourceContext);
        else this.renderControl(source, sourceContext);
      }
    }

    label(source) { return text(direct(source, "label")[0]) || source.getAttribute("label") || ""; }
    hint(source) { return text(direct(source, "hint")[0]); }
    alert(source) { return text(direct(source, "alert")[0]) || "This value is not valid."; }

    moveContent(source, target, context, excluded = []) {
      const ignored = new Set(excluded);
      for (const child of Array.from(source.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE && ignored.has(localName(child)) && isXForms(child)) continue;
        if (child.nodeType === Node.ELEMENT_NODE) this.model.setContext(child, context);
        target.append(child);
      }
    }

    renderGroup(source, context) {
      const fieldset = this.document.createElement("fieldset");
      fieldset.className = "xfr-group";
      const label = this.label(source);
      if (label) {
        const legend = this.document.createElement("legend");
        legend.textContent = label;
        fieldset.append(legend);
      }
      this.moveContent(source, fieldset, context, ["label", "hint"]);
      const hint = this.hint(source);
      if (hint) fieldset.append(this.hintElement(hint));
      source.replaceWith(fieldset);
    }

    renderSwitch(source, context) {
      const view = this.document.createElement("div");
      view.className = "xfr-switch";
      view.dataset.xfrSwitch = source.id || `switch-${++this.sequence}`;
      this.moveContent(source, view, context, ["label", "hint"]);
      source.replaceWith(view);
    }

    renderCase(source, context) {
      const view = this.document.createElement("section");
      view.className = "xfr-case";
      view.dataset.xfrCase = source.id || `case-${++this.sequence}`;
      view.hidden = source.getAttribute("selected") !== "true";
      this.moveContent(source, view, context, ["label", "hint"]);
      source.replaceWith(view);
    }

    renderRepeat(source, context) {
      const view = this.document.createElement("div");
      view.className = "xfr-repeat";
      view.dataset.xfrRepeat = source.id || `repeat-${++this.sequence}`;
      const nodes = this.model.nodesFor(source, context);
      const template = Array.from(source.childNodes).map((node) => node.cloneNode(true));
      if (!nodes.length) {
        const empty = this.document.createElement("p");
        empty.className = "xfr-hint";
        empty.textContent = "No items are available.";
        view.append(empty);
      }
      nodes.forEach((node, index) => {
        const row = this.document.createElement("div");
        row.className = "xfr-repeat-item";
        row.dataset.xfrRepeatIndex = String(index + 1);
        for (const templateNode of template) {
          const clone = templateNode.cloneNode(true);
          if (clone.nodeType === Node.ELEMENT_NODE) this.model.setContext(clone, node);
          row.append(clone);
        }
        view.append(row);
      });
      source.replaceWith(view);
      this.renderTree(view, context);
      if (source.id) this.repeatIndex.set(source.id, 1);
    }

    renderControl(source, context) {
      const name = localName(source);
      const wrapper = this.document.createElement("div");
      wrapper.className = "xfr-control";
      const id = `xfr-${++this.sequence}`;
      const label = this.label(source);
      let input;
      const type = this.model.bindFor(source)?.getAttribute("type")?.split(":").pop();

      if (name === "output") {
        input = this.document.createElement("output");
        input.className = "xfr-output-value";
      } else if (name === "textarea") {
        input = this.document.createElement("textarea");
      } else if (name === "select" || name === "select1") {
        input = this.document.createElement("select");
        input.multiple = name === "select";
        this.populateItems(source, input, context);
      } else if (name === "trigger" || name === "submit") {
        input = this.document.createElement("button");
        input.type = "button";
        input.textContent = label || (name === "submit" ? "Submit" : "Continue");
      } else {
        input = this.document.createElement("input");
        input.type = name === "secret" ? "password" : name === "range" ? "range" : type === "boolean" ? "checkbox" : "text";
        if (name === "range") {
          input.min = source.getAttribute("start") || source.getAttribute("min") || "0";
          input.max = source.getAttribute("end") || source.getAttribute("max") || "100";
          input.step = source.getAttribute("step") || "1";
        }
      }
      input.id = id;
      if (label && !["trigger", "submit"].includes(name)) {
        const labelElement = this.document.createElement("label");
        labelElement.htmlFor = id;
        labelElement.textContent = label;
        wrapper.append(labelElement);
      }
      wrapper.append(input);
      const hint = this.hint(source);
      if (hint) wrapper.append(this.hintElement(hint));
      const alert = this.document.createElement("div");
      alert.className = "xfr-alert";
      alert.hidden = true;
      alert.textContent = this.alert(source);
      wrapper.append(alert);
      source.replaceWith(wrapper);

      const record = { source, context, name, wrapper, input, alert, node: null };
      this.records.push(record);
      if (source.id) this.bySourceId.set(source.id, record);
      this.byDomId.set(id, record);
      if (["trigger", "submit"].includes(name)) {
        input.addEventListener("click", () => this.activate(record));
      } else if (name !== "output") {
        const event = ["input", "secret", "textarea", "range"].includes(name) ? "input" : "change";
        input.addEventListener(event, () => this.commit(record));
        if (event === "input") input.addEventListener("change", () => this.commit(record));
      }
    }

    populateItems(source, select, context) {
      for (const item of descendants(source, "item")) {
        const option = this.document.createElement("option");
        option.value = text(direct(item, "value")[0]);
        option.textContent = text(direct(item, "label")[0]) || option.value;
        select.append(option);
      }
      // Itemset is intentionally identified but not silently emulated.
      if (descendants(source, "itemset").length) this.report("xf:itemset is reference-only until its dynamic XPath renderer is enabled.", "error");
    }

    hintElement(value) {
      const element = this.document.createElement("div");
      element.className = "xfr-hint";
      element.textContent = value;
      return element;
    }

    valueFrom(record) {
      if (record.input.type === "checkbox") return record.input.checked ? "true" : "false";
      if (record.name === "select") return Array.from(record.input.selectedOptions).map((option) => option.value).join(" ");
      return record.input.value;
    }

    commit(record) {
      const node = this.model.nodeFor(record.source, record.context);
      const properties = this.model.modelItemProperties(record.source, node);
      if (!node || properties.readonly || !properties.relevant) return;
      this.model.mutate(node, this.valueFrom(record));
      this.model.runUpdate({ rebuild: false, reason: "value-changed" });
      root.utils.dispatch(record.wrapper, "xforms-value-changed", { node, value: node.textContent });
    }

    async activate(record) {
      if (record.name === "submit") {
        await this.actions?.submission.send(record.source.getAttribute("submission"), record.context);
      } else {
        await this.actions?.executeChildren(record.source, record.context, { target: record.wrapper });
      }
    }

    refresh() {
      for (const record of this.records) {
        const node = this.model.nodeFor(record.source, record.context);
        record.node = node;
        const properties = this.model.modelItemProperties(record.source, node);
        const value = node?.textContent || "";
        const interactive = !["output", "trigger", "submit"].includes(record.name);
        if (record.name === "output") record.input.value = value;
        else if (record.input.type === "checkbox") record.input.checked = /^(true|1)$/i.test(value);
        else if (record.name === "select") {
          const selected = new Set(value.trim() ? value.trim().split(/\s+/) : []);
          for (const option of record.input.options) option.selected = selected.has(option.value);
        } else if (!["trigger", "submit"].includes(record.name) && record.input.value !== value) record.input.value = value;
        record.input.disabled = !properties.relevant || properties.readonly || (!node && interactive);
        record.input.required = Boolean(properties.required && interactive);
        record.wrapper.hidden = !properties.relevant;
        record.wrapper.classList.toggle("xfr-irrelevant", !properties.relevant);
        record.wrapper.classList.toggle("xfr-readonly", properties.readonly);
        record.wrapper.classList.toggle("xfr-required", properties.required);
        record.wrapper.classList.toggle("xfr-invalid", !properties.valid);
        record.alert.hidden = properties.valid || !properties.relevant;
        record.input.setAttribute("aria-invalid", String(!properties.valid));
      }
      for (const switchView of this.document.querySelectorAll(".xfr-switch")) {
        const cases = Array.from(switchView.querySelectorAll(":scope > .xfr-case"));
        if (cases.length && !cases.some((view) => !view.hidden)) cases[0].hidden = false;
      }
    }

    toggleCase(id) {
      const target = this.document.querySelector(`.xfr-case[data-xfr-case="${CSS.escape(id)}"]`);
      if (!target) throw new Error(`xf:toggle references unknown case '${id}'.`);
      for (const candidate of target.parentElement.querySelectorAll(":scope > .xfr-case")) candidate.hidden = candidate !== target;
    }

    setRepeatIndex(id, index) {
      if (!id) return;
      this.repeatIndex.set(id, index);
      const repeat = this.document.querySelector(`.xfr-repeat[data-xfr-repeat="${CSS.escape(id)}"]`);
      const row = repeat?.querySelector(`.xfr-repeat-item[data-xfr-repeat-index="${index}"]`);
      row?.scrollIntoView({ block: "nearest" });
    }

    focus(id) { this.bySourceId.get(id)?.input.focus(); }
    targetForId(id) { return this.bySourceId.get(id)?.wrapper || this.document.getElementById(id) || null; }
  }

  root.ControlRenderer = ControlRenderer;
})();
