/*
 * XForm Revival — model and model-item-property engine.
 * Historical reference: extensions/xforms/nsXFormsModelElement.*, nsXFormsNodeState.*,
 * nsXFormsInstanceElement.*, and nsXFormsAccessors.*
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const {
    direct, descendants, isXForms, createXmlDocumentFromHtmlNode, parseXml, xpathNodes,
    xpathString, xpathBoolean, splitArguments, dispatch, sameOriginUrl
  } = root.utils;

  class XFormsModel {
    constructor(pageDocument, element, report = () => {}) {
      this.document = pageDocument;
      this.element = element;
      this.report = report;
      this.instances = new Map();
      this.initialXml = new Map();
      this.binds = [];
      this.bindById = new Map();
      this.submissions = new Map();
      this.nodeProperties = new WeakMap();
      this.nodeContexts = new WeakMap();
      this.updateDepth = 0;
      this.rebuildRequested = true;
      this.changedNodes = new Set();
      this.idSequence = 0;
      this.mdg = new root.MasterDependencyGraph(this);
    }

    async initialize() {
      for (const instanceElement of direct(this.element, "instance")) await this.addInstance(instanceElement);
      this.binds = descendants(this.element, "bind");
      for (const bind of this.binds) this.bindById.set(this.bindId(bind), bind);
      for (const submission of descendants(this.element, "submission")) {
        const id = submission.getAttribute("id") || `submission-${this.submissions.size + 1}`;
        this.submissions.set(id, submission);
      }
      this.runUpdate({ rebuild: true, reason: "construct" });
      dispatch(this.element, "xforms-model-construct-done", { model: this });
    }

    async addInstance(instanceElement) {
      const id = instanceElement.getAttribute("id") || (this.instances.size === 0 ? "default" : `instance-${this.instances.size + 1}`);
      const resource = instanceElement.getAttribute("src") || instanceElement.getAttribute("resource");
      let xml;
      if (resource) {
        const url = sameOriginUrl(this.document, resource);
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`Unable to load XForms instance '${id}': HTTP ${response.status}`);
        xml = parseXml(await response.text());
      } else {
        const rootNode = Array.from(instanceElement.children).find((child) => !isXForms(child));
        if (!rootNode) throw new Error(`XForms instance '${id}' has no data document.`);
        xml = createXmlDocumentFromHtmlNode(rootNode);
      }
      this.instances.set(id, xml);
      this.initialXml.set(id, new XMLSerializer().serializeToString(xml));
    }

    bindId(bind) {
      if (!bind.id) bind.id = `xfr-bind-${++this.idSequence}`;
      return bind.id;
    }

    defaultInstance() {
      return this.instances.get("default") || this.instances.values().next().value || null;
    }

    instanceFor(element) {
      const id = element?.getAttribute?.("instance");
      return (id && this.instances.get(id)) || this.defaultInstance();
    }

    contextFor(element, fallback = null) {
      return this.nodeContexts.get(element) || fallback || this.instanceFor(element)?.documentElement || null;
    }

    setContext(element, node) {
      this.nodeContexts.set(element, node);
    }

    bindFor(element) {
      const bindId = element?.getAttribute?.("bind");
      return bindId ? this.bindById.get(bindId) || null : null;
    }

    referenceFor(element) {
      const bind = this.bindFor(element);
      return element?.getAttribute?.("nodeset") || element?.getAttribute?.("ref") ||
        bind?.getAttribute("nodeset") || bind?.getAttribute("ref") || ".";
    }

    nodesFor(element, fallback = null) {
      const context = this.contextFor(element, fallback);
      return xpathNodes(this.document, this.referenceFor(element), context);
    }

    nodeFor(element, fallback = null) {
      return this.nodesFor(element, fallback)[0] || null;
    }

    nodesForBind(bind) {
      const context = this.instanceFor(bind)?.documentElement;
      return context ? xpathNodes(this.document, bind.getAttribute("nodeset") || bind.getAttribute("ref") || ".", context) : [];
    }

    evaluateString(expression, context) {
      if (!expression) return "";
      const match = String(expression).trim().match(/^(if|choose)\((.*)\)$/s);
      if (match) {
        const parts = splitArguments(match[2]);
        if (parts.length === 3) return this.evaluateBoolean(parts[0], context)
          ? this.evaluateString(parts[1], context)
          : this.evaluateString(parts[2], context);
      }
      return xpathString(this.document, expression, context);
    }

    evaluateBoolean(expression, context) {
      if (!expression) return false;
      const match = String(expression).trim().match(/^(if|choose)\((.*)\)$/s);
      if (match) {
        const parts = splitArguments(match[2]);
        if (parts.length === 3) return this.evaluateBoolean(parts[0], context)
          ? this.evaluateBoolean(parts[1], context)
          : this.evaluateBoolean(parts[2], context);
      }
      return xpathBoolean(this.document, expression, context);
    }

    modelItemProperties(element, node) {
      const bind = this.bindFor(element);
      return this.propertiesFor(bind, node);
    }

    propertiesFor(bind, node) {
      if (!node) return { relevant: false, readonly: true, required: false, valid: false, type: "" };
      const property = (name, fallback) => !bind?.hasAttribute(name)
        ? fallback
        : this.evaluateBoolean(bind.getAttribute(name), node);
      return {
        relevant: property("relevant", true),
        readonly: property("readonly", false),
        required: property("required", false),
        valid: this.nodeProperties.get(node)?.valid !== false,
        type: bind?.getAttribute("type") || ""
      };
    }

    mutate(node, value, structural = false) {
      if (!node) return;
      if (node.textContent !== value) {
        node.textContent = value;
        this.changedNodes.add(node);
        this.mdg.markNodeDirty(node);
      }
      if (structural) this.rebuildRequested = true;
    }

    runUpdate({ rebuild = false, reason = "mutation" } = {}) {
      if (this.updateDepth > 8) throw new Error("XForms update loop exceeded safe depth.");
      this.updateDepth += 1;
      try {
        if (rebuild || this.rebuildRequested) {
          this.mdg.rebuild();
          this.rebuildRequested = false;
          dispatch(this.element, "xforms-rebuild", { model: this, reason });
        }
        const recalculated = this.mdg.recalculate();
        recalculated.forEach((node) => this.changedNodes.add(node));
        dispatch(this.element, "xforms-recalculate", { model: this, changedNodes: [...this.changedNodes] });
        this.revalidate();
        dispatch(this.element, "xforms-revalidate", { model: this, changedNodes: [...this.changedNodes] });
        dispatch(this.element, "xforms-refresh", { model: this, changedNodes: [...this.changedNodes] });
        this.changedNodes.clear();
      } finally {
        this.updateDepth -= 1;
      }
    }

    revalidate() {
      for (const bind of this.binds) {
        for (const node of this.nodesForBind(bind)) {
          const relevant = !bind.hasAttribute("relevant") || this.evaluateBoolean(bind.getAttribute("relevant"), node);
          const required = bind.hasAttribute("required") && this.evaluateBoolean(bind.getAttribute("required"), node);
          const constraint = !bind.hasAttribute("constraint") || this.evaluateBoolean(bind.getAttribute("constraint"), node);
          const type = bind.getAttribute("type") || "";
          const valid = !relevant || ((!required || node.textContent.trim().length > 0) && constraint && this.matchesType(node.textContent, type));
          this.nodeProperties.set(node, { relevant, required, valid, type });
          dispatch(node, valid ? "xforms-valid" : "xforms-invalid", { bind, valid });
        }
      }
    }

    matchesType(value, qname) {
      const type = qname.split(":").pop();
      if (!value || !type) return true;
      if (type === "boolean") return /^(true|false|0|1)$/i.test(value);
      if (["integer", "int", "long", "short", "byte", "nonNegativeInteger"].includes(type)) return /^[+-]?\d+$/.test(value);
      if (["decimal", "double", "float"].includes(type)) return /^[+-]?(?:\d+|\d*\.\d+)(?:[Ee][+-]?\d+)?$/.test(value);
      if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value);
      if (type === "dateTime") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
      if (type === "time") return /^\d{2}:\d{2}/.test(value);
      if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      return true;
    }

    reset() {
      for (const [id, source] of this.initialXml) {
        const restored = parseXml(source);
        const existing = this.instances.get(id);
        if (!existing?.documentElement) {
          this.instances.set(id, restored);
          continue;
        }
        const target = existing.documentElement;
        const replacement = restored.documentElement;
        for (const attribute of Array.from(target.attributes || [])) target.removeAttribute(attribute.name);
        for (const attribute of Array.from(replacement.attributes || [])) target.setAttribute(attribute.name, attribute.value);
        while (target.firstChild) target.removeChild(target.firstChild);
        for (const child of Array.from(replacement.childNodes || [])) target.append(existing.importNode(child, true));
      }
      this.rebuildRequested = true;
      this.runUpdate({ rebuild: true, reason: "reset" });
      dispatch(this.element, "xforms-reset", { model: this });
    }
  }

  root.XFormsModel = XFormsModel;
})();
