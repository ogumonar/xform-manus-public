/*
 * XForm Revival — dependency graph.
 * Historical reference: extensions/xforms/nsXFormsMDGEngine.* and
 * extensions/xforms/nsXFormsXPathAnalyzer.*
 * New standards-native implementation.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const { splitArguments } = root.utils;

  const ignoredWords = new Set([
    "and", "or", "mod", "div", "true", "false", "not", "contains", "concat", "count",
    "starts-with", "substring", "string-length", "normalize-space", "boolean", "number", "string",
    "sum", "floor", "ceiling", "round", "position", "last", "name", "local-name", "namespace-uri",
    "current", "instance", "context", "event", "if", "choose", "today", "now", "random"
  ]);

  function sanitizeStringLiterals(expression) {
    return String(expression || "").replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, " ");
  }

  function expressionDependencies(expression) {
    const source = sanitizeStringLiterals(expression);
    const dependencies = new Set();
    // This intentionally extracts likely location paths. Browser XPath remains authoritative for evaluation.
    const tokens = source.match(/(?:\.\.?\/|\/)?(?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*(?:\/(?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*)*/g) || [];
    for (const token of tokens) {
      const simple = token.replace(/^.*\//, "").toLowerCase();
      const next = source.slice(source.indexOf(token) + token.length).trimStart();
      if ((token.includes("/") || !ignoredWords.has(simple)) && !next.startsWith("(")) dependencies.add(token);
    }
    return [...dependencies];
  }

  class MasterDependencyGraph {
    constructor(model) {
      this.model = model;
      this.bindNodes = new Map();
      this.forward = new Map();
      this.reverse = new Map();
      this.dirty = new Set();
      this.built = false;
    }

    rebuild() {
      this.bindNodes.clear();
      this.forward.clear();
      this.reverse.clear();
      for (const bind of this.model.binds) {
        const id = this.model.bindId(bind);
        const nodes = this.model.nodesForBind(bind);
        this.bindNodes.set(id, nodes);
        const expression = bind.getAttribute("calculate") || "";
        const dependencies = expressionDependencies(expression);
        const edges = new Set();
        for (const dependency of dependencies) {
          for (const candidate of this.model.binds) {
            const candidateId = this.model.bindId(candidate);
            const reference = candidate.getAttribute("nodeset") || candidate.getAttribute("ref") || "";
            if (reference && (dependency === reference || dependency.endsWith(`/${reference}`) || reference.endsWith(`/${dependency}`))) {
              edges.add(candidateId);
              if (!this.reverse.has(candidateId)) this.reverse.set(candidateId, new Set());
              this.reverse.get(candidateId).add(id);
            }
          }
        }
        this.forward.set(id, edges);
      }
      this.dirty = new Set(this.bindNodes.keys());
      this.built = true;
    }

    markNodeDirty(node) {
      const visited = new Set();
      for (const [id, nodes] of this.bindNodes) {
        if (nodes.includes(node)) this.markBindDirty(id, visited);
      }
    }

    markBindDirty(id, visited = new Set()) {
      if (visited.has(id)) return;
      visited.add(id);
      this.dirty.add(id);
      for (const dependent of this.reverse.get(id) || []) this.markBindDirty(dependent, visited);
    }

    calculationOrder() {
      const calculated = this.model.binds.filter((bind) => bind.hasAttribute("calculate"));
      const calculatedIds = new Set(calculated.map((bind) => this.model.bindId(bind)));
      const visited = new Set();
      const visiting = new Set();
      const ordered = [];
      const visit = (id) => {
        if (visited.has(id)) return;
        if (visiting.has(id)) throw new Error(`Circular XForms calculate dependency involving '${id}'.`);
        visiting.add(id);
        for (const dependency of this.forward.get(id) || []) if (calculatedIds.has(dependency)) visit(dependency);
        visiting.delete(id);
        visited.add(id);
        ordered.push(id);
      };
      for (const bind of calculated) visit(this.model.bindId(bind));
      return ordered;
    }

    recalculate() {
      if (!this.built) this.rebuild();
      const changed = [];
      for (const id of this.calculationOrder()) {
        if (!this.dirty.has(id)) continue;
        const bind = this.model.bindById.get(id);
        for (const node of this.model.nodesForBind(bind)) {
          const value = this.model.evaluateString(bind.getAttribute("calculate"), node);
          if (node.textContent !== value) {
            node.textContent = value;
            changed.push(node);
            this.markNodeDirty(node);
          }
        }
      }
      this.dirty.clear();
      return changed;
    }
  }

  root.MasterDependencyGraph = MasterDependencyGraph;
  root.expressionDependencies = expressionDependencies;
})();
