/* XForm Revival — constrained opt-in browser model recalculator. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};

  class ConstrainedRecalculationError extends Error {
    constructor(code, message) { super(message); this.name = "ConstrainedRecalculationError"; this.code = code; }
  }

  function elements(documentNode) { return [documentNode.documentElement, ...documentNode.documentElement.querySelectorAll("*")]; }

  class XFormsConstrainedRecalculator {
    static create({ inlineInstanceXml, bindings } = {}) {
      if (!root.XFormsBindTargetResolver?.resolve || !root.XFormsStaticDependencyExtractor?.extract || !root.XFormsPropertyEvaluator?.evaluate) {
        throw new ConstrainedRecalculationError("dependencies-unavailable", "Load bind target resolver, static dependency extractor, and property evaluator before the constrained recalculator.");
      }
      const instanceDocument = new DOMParser().parseFromString(inlineInstanceXml, "application/xml");
      if (instanceDocument.querySelector("parsererror")) throw new ConstrainedRecalculationError("invalid-instance", "Cannot parse inline XML for constrained recalculation.");
      const resolvedBindings = root.XFormsBindTargetResolver.resolve({ instanceDocument, bindings });
      const extracted = root.XFormsStaticDependencyExtractor.extract({ instanceDocument, bindings, resolvedBindings });
      if (extracted.diagnostics.length) throw new ConstrainedRecalculationError("incomplete-static-dependencies", "Constrained recalculation requires diagnostic-free static dependency extraction.");
      const byIndex = new Map(resolvedBindings.map((entry) => [entry.bindingIndex, entry]));
      const calculations = new Map();
      for (let index = 0; index < bindings.length; index += 1) {
        const expression = bindings[index]?.properties?.calculate;
        const targets = byIndex.get(index)?.nodeIds || [];
        if (!expression) continue;
        if (targets.length !== 1) throw new ConstrainedRecalculationError("unsupported-calculate-target-cardinality", `Calculated binding ${index} has ${targets.length} targets.`);
        calculations.set(targets[0], { expression, namespaces: bindings[index].namespaces || {}, declarationIndex: index });
      }
      return new XFormsConstrainedRecalculator(instanceDocument, extracted.edges, calculations);
    }

    constructor(instanceDocument, edges, calculations) {
      this.instanceDocument = instanceDocument;
      this.elements = elements(instanceDocument);
      this.edges = edges;
      this.calculations = calculations;
      this.lastSubmissionSequence = 0;
    }

    applyPatches(sequence, patches, submitCalculatedValues) {
      for (const patch of patches) {
        if (typeof patch?.state?.value === "string" && this.elements[patch.nodeId]) this.elements[patch.nodeId].textContent = patch.state.value;
      }
      if (sequence <= this.lastSubmissionSequence) return false;
      const changed = new Set(patches.map((patch) => patch.nodeId));
      const candidateTargets = [...new Set(this.edges.filter((edge) => changed.has(edge.source) && this.calculations.has(edge.dependent)).map((edge) => edge.dependent))]
        .sort((left, right) => this.calculations.get(left).declarationIndex - this.calculations.get(right).declarationIndex);
      const values = [];
      for (const nodeId of candidateTargets) {
        const calculation = this.calculations.get(nodeId);
        const value = root.XFormsPropertyEvaluator.evaluate({ property: "calculate", expression: calculation.expression, documentNode: this.instanceDocument, contextNode: this.elements[nodeId], contextPosition: 1, contextSize: 1, namespaceResolver: (prefix) => calculation.namespaces[prefix] ?? null }).value;
        if (value !== this.elements[nodeId].textContent) {
          this.elements[nodeId].textContent = value;
          values.push({ nodeId, value });
        }
      }
      if (!values.length) return false;
      this.lastSubmissionSequence = sequence;
      submitCalculatedValues(sequence, values);
      return true;
    }
  }

  root.ConstrainedRecalculationError = ConstrainedRecalculationError;
  root.XFormsConstrainedRecalculator = XFormsConstrainedRecalculator;
})();
