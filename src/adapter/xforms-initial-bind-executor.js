/*
 * XForm Revival — opt-in initial bind execution adapter.
 *
 * This module is deliberately browser-model-adapter code. It transiently parses
 * discovered inline XML, delegates target and property evaluation, and returns
 * structured hydration projections. It never touches components or the worker.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const FLAGS = Object.freeze({ relevant: 0x01, readonly: 0x02, required: 0x04, valid: 0x08 });
  const BOOLEAN_PROPERTIES = Object.freeze(["relevant", "readonly", "required", "constraint"]);

  class InitialBindExecutionError extends Error {
    constructor(code, message, cause = null) {
      super(message);
      this.name = "InitialBindExecutionError";
      this.code = code;
      this.cause = cause;
    }
  }

  function fail(code, message, cause = null) {
    throw new InitialBindExecutionError(code, message, cause);
  }

  function parseInlineInstance(xml) {
    if (typeof xml !== "string" || xml.trim() === "") fail("invalid-inline-instance", "Initial bind execution requires non-empty inline instance XML.");
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    if (documentNode.querySelector("parsererror") || !documentNode.documentElement) {
      fail("invalid-inline-instance", "Initial bind execution could not parse inline instance XML.");
    }
    return documentNode;
  }

  function elementByNodeId(instanceDocument) {
    return [instanceDocument.documentElement, ...instanceDocument.documentElement.querySelectorAll("*")];
  }

  function claim(claimed, nodeId, property, bindingIndex) {
    const properties = claimed.get(nodeId) || new Set();
    if (properties.has(property)) {
      fail("duplicate-model-item-property", `Bind ${bindingIndex} redeclares '${property}' for compact node ${nodeId}.`);
    }
    properties.add(property);
    claimed.set(nodeId, properties);
  }

  function evaluate(property, expression, instanceDocument, contextNode, namespaceResolver) {
    try {
      return root.XFormsPropertyEvaluator.evaluate({
        property,
        expression,
        documentNode: instanceDocument,
        contextNode,
        contextPosition: 1,
        contextSize: 1,
        namespaceResolver
      }).value;
    } catch (error) {
      fail("property-evaluation-failed", `Could not evaluate ${property} expression '${expression}': ${error.message}`, error);
    }
  }

  function flagsFor(state) {
    return (state.relevant ? FLAGS.relevant : 0)
      | (state.readonly ? FLAGS.readonly : 0)
      | (state.required ? FLAGS.required : 0)
      | (state.valid ? FLAGS.valid : 0);
  }

  function resolvedBindingMap(resolvedBindings) {
    return new Map(resolvedBindings.map((entry) => [entry.bindingIndex, entry]));
  }

  class XFormsInitialBindExecutor {
    static execute({ inlineInstanceXml, bindings } = {}) {
      if (!root.XFormsBindTargetResolver?.resolve || !root.XFormsPropertyEvaluator?.evaluate) {
        fail("execution-dependencies-unavailable", "Load bind-target resolver and property evaluator modules before xforms-initial-bind-executor.js.");
      }
      if (!Array.isArray(bindings)) throw new TypeError("Initial bind execution requires an ordered bindings array.");
      const instanceDocument = parseInlineInstance(inlineInstanceXml);
      let resolvedBindings;
      try {
        resolvedBindings = root.XFormsBindTargetResolver.resolve({ instanceDocument, bindings });
      } catch (error) {
        fail("bind-target-resolution-failed", `Could not resolve discovered bind targets: ${error.message}`, error);
      }
      const elements = elementByNodeId(instanceDocument);
      const byBindingIndex = resolvedBindingMap(resolvedBindings);
      const claimed = new Map();
      const initialValues = new Map();
      const states = new Map();

      for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
        const binding = bindings[bindingIndex];
        const expression = binding?.properties?.calculate;
        if (!expression) continue;
        const resolved = byBindingIndex.get(bindingIndex);
        for (const nodeId of resolved?.nodeIds || []) {
          claim(claimed, nodeId, "calculate", bindingIndex);
          const element = elements[nodeId];
          const value = evaluate("calculate", expression, instanceDocument, element, (prefix) => binding.namespaces?.[prefix] ?? null);
          element.textContent = value;
          initialValues.set(nodeId, value);
        }
      }

      for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
        const binding = bindings[bindingIndex];
        const resolved = byBindingIndex.get(bindingIndex);
        for (const nodeId of resolved?.nodeIds || []) {
          const element = elements[nodeId];
          let state = states.get(nodeId);
          for (const property of BOOLEAN_PROPERTIES) {
            const expression = binding?.properties?.[property];
            if (!expression) continue;
            claim(claimed, nodeId, property, bindingIndex);
            state = state || { relevant: true, readonly: false, required: false, constraint: true };
            state[property] = evaluate(property, expression, instanceDocument, element, (prefix) => binding.namespaces?.[prefix] ?? null);
            states.set(nodeId, state);
          }
        }
      }

      const initialModelItemFlags = Array.from(states, ([nodeId, state]) => {
        const element = elements[nodeId];
        const valid = !state.relevant || ((!state.required || element.textContent.trim().length > 0) && state.constraint);
        return Object.freeze({
          nodeId,
          flags: flagsFor({ relevant: state.relevant, readonly: state.readonly, required: state.required, valid })
        });
      });

      return Object.freeze({
        initialValues: Object.freeze(Array.from(initialValues, ([nodeId, value]) => Object.freeze({ nodeId, value }))),
        initialModelItemFlags: Object.freeze(initialModelItemFlags)
      });
    }
  }

  root.InitialBindExecutionError = InitialBindExecutionError;
  root.XFormsInitialBindExecutor = XFormsInitialBindExecutor;
})();
