/* XForm Revival — conservative static XPath dependency extractor. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const ignored = new Set(["and", "or", "mod", "div"]);
  const properties = ["calculate", "readonly", "relevant", "required", "constraint"];

  function freezeDiagnostic(code, bindingIndex, property, expression, message) {
    return Object.freeze({ code, bindingIndex, property, expression, message });
  }

  function elementNodes(documentNode) {
    return [documentNode.documentElement, ...documentNode.documentElement.querySelectorAll("*")];
  }

  function sanitizeStrings(source) {
    return String(source).replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, " ");
  }

  function staticTokens(expression) {
    const source = sanitizeStrings(expression);
    const tokens = [];
    const expressionHasUnsupportedSyntax = /(?:\[|\]|@|\*|\||\/\/|\$)/.test(source);
    const pattern = /(?:\.\.?(?:\/[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)*|\/(?:[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?:\/[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)*|[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?(?:\/[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)*)/g;
    for (const match of source.matchAll(pattern)) {
      const token = match[0];
      const following = source.slice(match.index + token.length).trimStart();
      if (following.startsWith("(") || ignored.has(token)) continue;
      tokens.push(token);
    }
    return { tokens: [...new Set(tokens)], expressionHasUnsupportedSyntax };
  }

  function extract({ instanceDocument, bindings, resolvedBindings } = {}) {
    if (!root.XPathCompatibility?.inspectXPath10 || !root.XPathCompatibility?.evaluateXPath10) throw new Error("Load xpath-compatibility.js before xforms-static-dependency-extractor.js.");
    if (!instanceDocument?.documentElement || !Array.isArray(bindings) || !Array.isArray(resolvedBindings)) throw new TypeError("Dependency extraction requires an instance document, bindings, and resolved bindings.");
    const resolvedByIndex = new Map(resolvedBindings.map((entry) => [entry.bindingIndex, entry]));
    const elements = elementNodes(instanceDocument);
    const ids = new Map(elements.map((node, nodeId) => [node, nodeId]));
    const edgeKeys = new Set();
    const diagnostics = [];
    for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
      const binding = bindings[bindingIndex];
      const targets = resolvedByIndex.get(bindingIndex)?.nodeIds || [];
      for (const property of properties) {
        const expression = binding?.properties?.[property];
        if (!expression) continue;
        try { root.XPathCompatibility.inspectXPath10(expression); } catch (error) {
          diagnostics.push(freezeDiagnostic("dependency-xpath-compatibility", bindingIndex, property, expression, error.message));
          continue;
        }
        const { tokens, expressionHasUnsupportedSyntax } = staticTokens(expression);
        if (expressionHasUnsupportedSyntax) diagnostics.push(freezeDiagnostic("unsupported-dependency-reference", bindingIndex, property, expression, "Expression contains an unsupported dynamic, predicate, attribute, wildcard, union, descendant, or variable form."));
        for (const targetId of targets) {
          const contextNode = elements[targetId];
          for (const token of tokens) {
            let selected;
            try {
              selected = root.XPathCompatibility.evaluateXPath10({ documentNode: instanceDocument, expression: token, contextNode, expectedResult: "nodes", namespaceResolver: (prefix) => binding.namespaces?.[prefix] ?? null }).value;
            } catch (error) {
              diagnostics.push(freezeDiagnostic("unsupported-dependency-reference", bindingIndex, property, token, error.message));
              continue;
            }
            if (selected.length === 0) {
              diagnostics.push(freezeDiagnostic("unresolved-dependency-reference", bindingIndex, property, token, "Supported static path selected no element."));
              continue;
            }
            for (const node of selected) {
              if (node.nodeType !== Node.ELEMENT_NODE) {
                diagnostics.push(freezeDiagnostic("unsupported-dependency-node-kind", bindingIndex, property, token, `Selected node type ${node.nodeType} is not a compact element.`));
                continue;
              }
              const source = ids.get(node);
              if (!Number.isSafeInteger(source)) continue;
              if (property === "calculate" && source === targetId) continue;
              edgeKeys.add(`${source}:${targetId}`);
            }
          }
        }
      }
    }
    const edges = [...edgeKeys].map((key) => {
      const [source, dependent] = key.split(":").map(Number);
      return Object.freeze({ source, dependent });
    }).sort((left, right) => left.source - right.source || left.dependent - right.dependent);
    return Object.freeze({ edges: Object.freeze(edges), diagnostics: Object.freeze(diagnostics) });
  }

  root.XFormsStaticDependencyExtractor = Object.freeze({ extract });
})();
