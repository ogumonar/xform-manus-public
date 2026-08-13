/*
 * XForm Revival — browser-only discovered bind target resolver.
 *
 * The resolver owns neither component presentation nor worker state. It consumes
 * a parsed inline instance DOM only long enough to turn one discovered bind tree
 * into immutable compact element IDs.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};

  class BindTargetResolutionError extends Error {
    constructor(code, message, detail = {}) {
      super(message);
      this.name = "BindTargetResolutionError";
      this.code = code;
      Object.assign(this, detail);
    }
  }

  function fail(code, message, detail = {}) {
    throw new BindTargetResolutionError(code, message, detail);
  }

  function assertInstanceDocument(instanceDocument) {
    if (!instanceDocument || instanceDocument.nodeType !== Node.DOCUMENT_NODE || !instanceDocument.documentElement) {
      fail("invalid-instance-document", "Bind target resolution requires an XML Document with one document element.");
    }
  }

  function compactElementMap(instanceDocument) {
    const elements = [instanceDocument.documentElement, ...instanceDocument.documentElement.querySelectorAll("*")];
    return new Map(elements.map((element, nodeId) => [element, nodeId]));
  }

  function namespaceResolver(binding) {
    const namespaces = binding?.namespaces || {};
    return (prefix) => namespaces[prefix] ?? null;
  }

  function resolveNodes(instanceDocument, binding, contextNode) {
    if (!root.XPathCompatibility?.inspectXPath10 || !root.XPathCompatibility?.evaluateXPath10) {
      fail("xpath-compatibility-unavailable", "Load xpath-compatibility.js before xforms-bind-target-resolver.js.");
    }
    if (typeof binding?.target !== "string" || binding.target.trim() === "") {
      fail("invalid-binding-target", "A discovered bind target must be a non-empty XPath expression.", { bindingIndex: binding?.bindingIndex });
    }
    try {
      root.XPathCompatibility.inspectXPath10(binding.target);
    } catch (error) {
      fail("xpath-compatibility", `Bind target '${binding.target}' is not XPath 1.0-compatible: ${error.message}`, {
        bindingIndex: binding.bindingIndex,
        cause: error
      });
    }
    try {
      return root.XPathCompatibility.evaluateXPath10({
        documentNode: instanceDocument,
        expression: binding.target,
        contextNode,
        expectedResult: "nodes",
        namespaceResolver: namespaceResolver(binding)
      }).value;
    } catch (error) {
      fail("xpath-evaluation-failed", `Bind target '${binding.target}' could not be evaluated: ${error.message}`, {
        bindingIndex: binding.bindingIndex,
        cause: error
      });
    }
  }

  function parentContext(binding, resolved, instanceDocument) {
    if (binding.parentBindingIndex === null || binding.parentBindingIndex === undefined) return instanceDocument.documentElement;
    if (!Number.isSafeInteger(binding.parentBindingIndex) || binding.parentBindingIndex < 0 || binding.parentBindingIndex >= resolved.length) {
      fail("unresolved-parent-binding", `Bind ${binding.bindingIndex} has no previously resolved parent binding ${binding.parentBindingIndex}.`, {
        bindingIndex: binding.bindingIndex,
        parentBindingIndex: binding.parentBindingIndex
      });
    }
    const parent = resolved[binding.parentBindingIndex];
    if (parent.elements.length === 0) {
      fail("unresolved-parent-binding", `Bind ${binding.bindingIndex} cannot evaluate because parent binding ${binding.parentBindingIndex} selected no element.`, {
        bindingIndex: binding.bindingIndex,
        parentBindingIndex: binding.parentBindingIndex
      });
    }
    if (parent.elements.length !== 1) {
      fail("unsupported-parent-cardinality", `Bind ${binding.bindingIndex} cannot evaluate below ${parent.elements.length} parent targets without repeat-aware XForms context expansion.`, {
        bindingIndex: binding.bindingIndex,
        parentBindingIndex: binding.parentBindingIndex,
        parentNodeCount: parent.elements.length
      });
    }
    return parent.elements[0];
  }

  function toCompactNodeIds(binding, elements, elementIds) {
    const nodeIds = [];
    for (const node of elements) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        fail("unsupported-target-node-kind", `Bind ${binding.bindingIndex} selected node type ${node.nodeType}; compact instance IDs exist only for elements.`, {
          bindingIndex: binding.bindingIndex,
          nodeType: node.nodeType
        });
      }
      const nodeId = elementIds.get(node);
      if (!Number.isSafeInteger(nodeId)) {
        fail("unmapped-target-node", `Bind ${binding.bindingIndex} selected an element outside the compact inline-instance identity map.`, {
          bindingIndex: binding.bindingIndex
        });
      }
      nodeIds.push(nodeId);
    }
    return Object.freeze(nodeIds);
  }

  class XFormsBindTargetResolver {
    static resolve({ instanceDocument, bindings } = {}) {
      assertInstanceDocument(instanceDocument);
      if (!Array.isArray(bindings)) throw new TypeError("Bind target resolution requires an ordered bindings array.");
      const elementIds = compactElementMap(instanceDocument);
      const resolved = [];
      for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
        const binding = { ...bindings[bindingIndex], bindingIndex };
        if (binding.targetKind !== "ref" && binding.targetKind !== "nodeset") {
          fail("invalid-binding-target-kind", `Bind ${bindingIndex} has unsupported target kind '${binding.targetKind}'.`, { bindingIndex });
        }
        const contextNode = parentContext(binding, resolved, instanceDocument);
        const elements = resolveNodes(instanceDocument, binding, contextNode);
        const nodeIds = toCompactNodeIds(binding, elements, elementIds);
        resolved.push({ binding, elements, nodeIds });
      }
      return Object.freeze(resolved.map(({ binding, nodeIds }) => Object.freeze({
        bindingIndex: binding.bindingIndex,
        sourceId: binding.sourceId ?? null,
        targetKind: binding.targetKind,
        target: binding.target,
        nodeIds
      })));
    }
  }

  root.BindTargetResolutionError = BindTargetResolutionError;
  root.XFormsBindTargetResolver = XFormsBindTargetResolver;
})();
