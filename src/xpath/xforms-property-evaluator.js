/*
 * XForm Revival — typed XForms model-item property evaluator.
 *
 * This adapter consumes DOM instance nodes only at the browser integration
 * boundary. Components never import it, and no result mutates the worker or
 * compact Rust model without a later model-execution adapter.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const propertyResults = Object.freeze({
    calculate: "string",
    readonly: "boolean",
    relevant: "boolean",
    required: "boolean",
    constraint: "boolean"
  });
  const xformsFunctions = new Set([
    "boolean-from-string", "is-card-number", "avg", "min", "max", "count-non-empty",
    "index", "power", "random", "compare", "if", "property", "digest", "hmac",
    "local-date", "local-dateTime", "now", "days-from-date", "days-to-date",
    "seconds-from-dateTime", "seconds-to-dateTime", "adjust-dateTime-to-timezone",
    "seconds", "months", "instance", "current", "context", "choose", "event"
  ]);

  class PropertyEvaluationError extends Error {
    constructor(code, message, cause = null) {
      super(message);
      this.name = "PropertyEvaluationError";
      this.code = code;
      this.cause = cause;
    }
  }

  function fail(code, message, cause = null) {
    throw new PropertyEvaluationError(code, message, cause);
  }

  function propertyResult(property) {
    const expectedResult = propertyResults[property];
    if (!expectedResult) fail("unsupported-property", `Unsupported XForms model-item property '${property}'.`);
    return expectedResult;
  }

  function assertSingletonContext({ contextPosition = 1, contextSize = 1 }) {
    if (!Number.isSafeInteger(contextPosition) || !Number.isSafeInteger(contextSize) || contextPosition < 1 || contextSize < 1) {
      fail("invalid-context-position", "XForms evaluation context position and size must be positive safe integers.");
    }
    if (contextPosition !== 1 || contextSize !== 1) {
      fail("unsupported-context-position", "This property evaluator currently supports only singleton XForms evaluation contexts (position 1 of size 1).");
    }
  }

  function assertNoVariables(variables) {
    if (variables === undefined || variables === null) return;
    if (typeof variables !== "object" || Array.isArray(variables) || Object.keys(variables).length !== 0) {
      fail("unsupported-variables", "XForms 1.1 property evaluation in this runtime does not support variable bindings.");
    }
  }

  function inspectExpression(expression) {
    if (!root.XPathCompatibility?.inspectXPath10 || !root.XPathCompatibility?.evaluateXPath10) {
      fail("xpath-compatibility-unavailable", "Load xpath-compatibility.js before xforms-property-evaluator.js.");
    }
    try {
      return root.XPathCompatibility.inspectXPath10(expression);
    } catch (error) {
      fail("xpath-compatibility", `Property expression is not XPath 1.0-compatible: ${error.message}`, error);
    }
  }

  function outerFunctionCall(source) {
    const trimmed = String(source).trim();
    const match = /^([A-Za-z_][A-Za-z0-9_.:-]*)\s*\(/.exec(trimmed);
    if (!match) return null;
    const open = trimmed.indexOf("(", match.index + match[1].length);
    let depth = 0;
    let quote = null;
    for (let index = open; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (quote) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          return trimmed.slice(index + 1).trim() === ""
            ? { name: match[1], argumentsSource: trimmed.slice(open + 1, index) }
            : null;
        }
      }
    }
    return null;
  }

  function splitTopLevelArguments(source) {
    const argumentsList = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth < 0) return null;
      } else if (character === "," && depth === 0) {
        argumentsList.push(source.slice(start, index).trim());
        start = index + 1;
      }
    }
    if (quote || depth !== 0) return null;
    argumentsList.push(source.slice(start).trim());
    return argumentsList.every(Boolean) ? argumentsList : null;
  }

  function calledFunctionNames(source) {
    const names = [];
    let quote = null;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
        continue;
      }
      if (!/[A-Za-z_]/.test(character)) continue;
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_.:-]/.test(source[index])) index += 1;
      const name = source.slice(start, index);
      while (index < source.length && /\s/.test(source[index])) index += 1;
      if (source[index] === "(") names.push(name);
      index -= 1;
    }
    return names;
  }

  function assertNoDeferredXFormsFunctions(expression) {
    for (const name of calledFunctionNames(expression)) {
      const localName = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
      if (xformsFunctions.has(localName)) {
        fail("xforms-function-deferred", `XForms function '${name}()' is not implemented by the browser property evaluator.`);
      }
    }
  }

  function evaluateNative(request, expression, expectedResult) {
    try {
      const outcome = root.XPathCompatibility.evaluateXPath10({
        documentNode: request.documentNode,
        expression,
        contextNode: request.contextNode,
        expectedResult,
        namespaceResolver: request.namespaceResolver ?? null
      });
      return outcome;
    } catch (error) {
      if (error instanceof PropertyEvaluationError) throw error;
      fail("xpath-evaluation-failed", `Browser XPath 1.0 evaluation failed: ${error.message}`, error);
    }
  }

  function evaluateExpression(request, expression, expectedResult) {
    const classification = inspectExpression(expression);
    const outer = outerFunctionCall(expression);
    if (outer && (outer.name === "if" || outer.name === "choose")) {
      const argumentsList = splitTopLevelArguments(outer.argumentsSource);
      if (!argumentsList || argumentsList.length !== 3) {
        fail("invalid-xforms-function", `XForms ${outer.name}() requires exactly three non-empty arguments.`);
      }
      const condition = evaluateExpression(request, argumentsList[0], "boolean");
      return evaluateExpression(request, condition.value ? argumentsList[1] : argumentsList[2], expectedResult);
    }
    assertNoDeferredXFormsFunctions(expression);
    const outcome = evaluateNative(request, expression, expectedResult);
    return Object.freeze({ classification: classification ?? outcome.classification, value: outcome.value });
  }

  class XFormsPropertyEvaluator {
    static evaluate(request = {}) {
      const expectedResult = propertyResult(request.property);
      assertSingletonContext(request);
      assertNoVariables(request.variables);
      if (!request.documentNode || !request.contextNode) {
        fail("missing-context", "Property evaluation requires an XML document and an explicit instance context node.");
      }
      if (request.namespaceResolver !== undefined && request.namespaceResolver !== null && typeof request.namespaceResolver !== "function") {
        fail("invalid-namespace-resolver", "Property evaluation namespaceResolver must be a function or null.");
      }
      const outcome = evaluateExpression(request, request.expression, expectedResult);
      return Object.freeze({
        property: request.property,
        expectedResult,
        classification: outcome.classification,
        value: outcome.value
      });
    }
  }

  root.PropertyEvaluationError = PropertyEvaluationError;
  root.XFormsPropertyEvaluator = XFormsPropertyEvaluator;
})();
