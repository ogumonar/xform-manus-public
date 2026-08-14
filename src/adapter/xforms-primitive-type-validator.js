/* XForm Revival — constrained XML Schema primitive lexical validator. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const XML_SCHEMA_NAMESPACE = "http://www.w3.org/2001/XMLSchema";
  const SUPPORTED = new Set(["string", "boolean", "integer", "decimal", "date", "dateTime"]);

  class PrimitiveTypeValidationError extends Error {
    constructor(code, message) { super(message); this.name = "PrimitiveTypeValidationError"; this.code = code; }
  }

  function resolveType(datatype, namespaces = {}) {
    if (!datatype) return null;
    const [prefix, local] = datatype.includes(":") ? datatype.split(":", 2) : ["", datatype];
    const namespace = namespaces[prefix] ?? (prefix === "xs" || prefix === "xsd" ? XML_SCHEMA_NAMESPACE : null);
    if (namespace !== XML_SCHEMA_NAMESPACE || !SUPPORTED.has(local)) {
      throw new PrimitiveTypeValidationError("unsupported-primitive-type", `Datatype '${datatype}' is outside the constrained XML Schema primitive subset.`);
    }
    return local;
  }

  function leapYear(year) { return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n); }

  function validDate(text) {
    const match = /^(-?\d{4,})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return false;
    const year = BigInt(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const days = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
  }

  function validDateTime(text) {
    const match = /^(-?\d{4,}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))?$/.exec(text);
    if (!match || !validDate(match[1])) return false;
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    const second = Number(match[4]);
    const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
    const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
    return hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 14 && offsetMinute <= 59 && (offsetHour !== 14 || offsetMinute === 0);
  }

  function validLexical(type, value) {
    const text = String(value ?? "");
    switch (type) {
      case "string": return true;
      case "boolean": return text === "true" || text === "false" || text === "0" || text === "1";
      case "integer": return /^[+-]?\d+$/.test(text);
      case "decimal": return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text);
      case "date": return validDate(text);
      case "dateTime": return validDateTime(text);
      default: return false;
    }
  }

  class XFormsPrimitiveTypeValidator {
    static validate({ datatype, namespaces, value } = {}) {
      const type = resolveType(datatype, namespaces);
      return Object.freeze({ datatype: type, valid: type === null || validLexical(type, value) });
    }
  }

  root.PrimitiveTypeValidationError = PrimitiveTypeValidationError;
  root.XFormsPrimitiveTypeValidator = XFormsPrimitiveTypeValidator;
})();
