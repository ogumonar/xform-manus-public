/*
 * XForm Revival — XPath 1.0 compatibility boundary.
 *
 * This module intentionally does not implement XPath. It gates known XPath
 * 2.x/3.x lexical forms and then delegates a test-only request to the browser's
 * XPath 1.0 evaluator. Production model evaluation remains a separate adapter.
 */
(() => {
  "use strict";

  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const resultTypes = Object.freeze({
    nodes: XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    string: XPathResult.STRING_TYPE,
    number: XPathResult.NUMBER_TYPE,
    boolean: XPathResult.BOOLEAN_TYPE,
    any: XPathResult.ANY_TYPE
  });
  const keywords = new Set([
    "cast", "castable", "else", "eq", "every", "for", "ge", "gt", "instance",
    "is", "le", "lt", "ne", "return", "satisfies", "some", "then", "treat"
  ]);

  class XPathCompatibilityError extends Error {
    constructor(code, offset, form) {
      super(`XPath 2.x/3.x syntax ${form} is not allowed at byte ${offset}.`);
      this.name = "XPathCompatibilityError";
      this.code = code;
      this.offset = offset;
      this.form = form;
    }
  }

  function syntax(offset, code, form) {
    throw new XPathCompatibilityError(code, offset, form);
  }

  function isNameStart(character) {
    return /[A-Za-z_]/.test(character);
  }

  function isNameCharacter(character) {
    return /[A-Za-z0-9_.:-]/.test(character);
  }

  function isKeywordBoundary(source, start, end) {
    const previous = source[start - 1];
    const next = source[end];
    return (!previous || (!isNameCharacter(previous) && previous !== "$")) && (!next || !isNameCharacter(next));
  }

  function followsOpeningParenthesis(source, offset) {
    for (let index = offset; index < source.length; index += 1) {
      if (!/\s/.test(source[index])) return source[index] === "(";
    }
    return false;
  }

  function inspectXPath10(source) {
    if (typeof source !== "string" || source.trim() === "") {
      const error = new Error("XPath expression is empty.");
      error.code = "empty-expression";
      throw error;
    }
    for (let index = 0; index < source.length;) {
      const character = source[index];
      if (character === "'" || character === '"') {
        const openingOffset = index;
        index += 1;
        while (index < source.length && source[index] !== character) index += 1;
        if (index === source.length) {
          const error = new Error(`XPath string literal is not terminated at byte ${openingOffset}.`);
          error.code = "unterminated-string";
          error.offset = openingOffset;
          throw error;
        }
        index += 1;
        continue;
      }
      const next = source[index + 1];
      if (character === "=" && next === ">") syntax(index, "xpath3-arrow", "'=>'");
      if (character === "!" && next === "!") syntax(index, "xpath3-simple-map", "'!!'");
      if (character === "<" && (next === "<" || next === ">")) syntax(index, "xpath2-node-order", "node-order comparison");
      if (character === "(" && next === ":") syntax(index, "xpath2-comment", "XPath comment delimiter");
      if (isNameStart(character)) {
        const start = index;
        index += 1;
        while (index < source.length && isNameCharacter(source[index])) index += 1;
        const token = source.slice(start, index);
        if (isKeywordBoundary(source, start, index) && keywords.has(token)) {
          if (token === "if" && followsOpeningParenthesis(source, index)) continue;
          syntax(start, "xpath2-keyword", `keyword '${token}'`);
        }
        continue;
      }
      index += 1;
    }
    return Object.freeze({ semantics: "xpath-1.0-compatibility", source });
  }

  function evaluateXPath10({ documentNode, expression, contextNode, expectedResult = "any", namespaceResolver = null }) {
    const classification = inspectXPath10(expression);
    const resultType = resultTypes[expectedResult];
    if (resultType === undefined) throw new TypeError(`Unsupported XPath compatibility result '${expectedResult}'.`);
    const owner = documentNode?.nodeType === Node.DOCUMENT_NODE ? documentNode : contextNode?.ownerDocument;
    if (!owner || !contextNode) throw new TypeError("XPath evaluation requires a document and context node.");
    const result = owner.evaluate(expression, contextNode, namespaceResolver, resultType, null);
    if (expectedResult === "nodes") {
      const nodes = [];
      for (let index = 0; index < result.snapshotLength; index += 1) nodes.push(result.snapshotItem(index));
      return Object.freeze({ classification, value: Object.freeze(nodes) });
    }
    const value = expectedResult === "string" ? result.stringValue
      : expectedResult === "number" ? result.numberValue
        : expectedResult === "boolean" ? result.booleanValue : result;
    return Object.freeze({ classification, value });
  }

  root.XPathCompatibility = Object.freeze({ inspectXPath10, evaluateXPath10, XPathCompatibilityError });
})();
