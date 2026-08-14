/* XForm Revival — constrained opt-in browser model recalculator. */
(() => {
  "use strict";
  const root = globalThis.XFormRevival = globalThis.XFormRevival || {};
  const FLAGS = Object.freeze({ relevant: 0x01, readonly: 0x02, required: 0x04, valid: 0x08 });
  const BOOLEAN_PROPERTIES = Object.freeze(["relevant", "readonly", "required", "constraint"]);

  class ConstrainedRecalculationError extends Error {
    constructor(code, message) { super(message); this.name = "ConstrainedRecalculationError"; this.code = code; }
  }

  function elements(documentNode) { return [documentNode.documentElement, ...documentNode.documentElement.querySelectorAll("*")]; }
  function flagsFor(state) { return (state.relevant ? FLAGS.relevant : 0) | (state.readonly ? FLAGS.readonly : 0) | (state.required ? FLAGS.required : 0) | (state.valid ? FLAGS.valid : 0); }

  class XFormsConstrainedRecalculator {
    static create({ inlineInstanceXml, bindings } = {}) {
      if (!root.XFormsBindTargetResolver?.resolve || !root.XFormsStaticDependencyExtractor?.extract || !root.XFormsPropertyEvaluator?.evaluate || !root.XFormsPrimitiveTypeValidator?.validate) {
        throw new ConstrainedRecalculationError("dependencies-unavailable", "Load bind target resolver, static dependency extractor, property evaluator, and primitive type validator before the constrained recalculator.");
      }
      const instanceDocument = new DOMParser().parseFromString(inlineInstanceXml, "application/xml");
      if (instanceDocument.querySelector("parsererror")) throw new ConstrainedRecalculationError("invalid-instance", "Cannot parse inline XML for constrained recalculation.");
      const resolvedBindings = root.XFormsBindTargetResolver.resolve({ instanceDocument, bindings });
      const extracted = root.XFormsStaticDependencyExtractor.extract({ instanceDocument, bindings, resolvedBindings });
      if (extracted.diagnostics.length) throw new ConstrainedRecalculationError("incomplete-static-dependencies", "Constrained recalculation requires diagnostic-free static dependency extraction.");
      const byIndex = new Map(resolvedBindings.map((entry) => [entry.bindingIndex, entry]));
      const calculations = new Map();
      const stateProperties = new Map();
      for (let index = 0; index < bindings.length; index += 1) {
        const binding = bindings[index];
        const targets = byIndex.get(index)?.nodeIds || [];
        const hasCalculate = Boolean(binding?.properties?.calculate);
        const hasState = BOOLEAN_PROPERTIES.some((property) => binding?.properties?.[property]) || Boolean(binding?.datatype);
        if (!hasCalculate && !hasState) continue;
        if (targets.length !== 1) throw new ConstrainedRecalculationError("unsupported-binding-target-cardinality", `Executable binding ${index} has ${targets.length} targets.`);
        const target = targets[0];
        if (hasCalculate) calculations.set(target, { expression: binding.properties.calculate, namespaces: binding.namespaces || {}, declarationIndex: index });
        if (hasState) stateProperties.set(target, { properties: binding.properties, datatype: binding.datatype || null, namespaces: binding.namespaces || {}, declarationIndex: index });
      }
      return new XFormsConstrainedRecalculator(instanceDocument, extracted.edges, calculations, stateProperties);
    }

    constructor(instanceDocument, edges, calculations, stateProperties) {
      this.instanceDocument = instanceDocument;
      this.elements = elements(instanceDocument);
      this.edges = edges;
      this.calculations = calculations;
      this.stateProperties = stateProperties;
      this.projectedFlags = new Map();
      this.pendingStateTargets = new Set();
      this.lastSubmissionSequence = 0;
    }

    evaluate(property, expression, nodeId, namespaces) {
      return root.XFormsPropertyEvaluator.evaluate({ property, expression, documentNode: this.instanceDocument, contextNode: this.elements[nodeId], contextPosition: 1, contextSize: 1, namespaceResolver: (prefix) => namespaces[prefix] ?? null }).value;
    }

    targetsFor(changed, collection) {
      return [...new Set(this.edges.filter((edge) => changed.has(edge.source) && collection.has(edge.dependent)).map((edge) => edge.dependent))]
        .sort((left, right) => collection.get(left).declarationIndex - collection.get(right).declarationIndex);
    }

    applyPatches(sequence, patches, submitCalculatedValues, submitResolvedModelItemState) {
      for (const patch of patches) {
        if (typeof patch?.state?.value === "string" && this.elements[patch.nodeId]) this.elements[patch.nodeId].textContent = patch.state.value;
        if (patch?.state) this.projectedFlags.set(patch.nodeId, flagsFor(patch.state));
      }
      if (sequence <= this.lastSubmissionSequence) return false;
      const changed = new Set(patches.map((patch) => patch.nodeId));
      const calculationTargets = this.targetsFor(changed, this.calculations);
      for (const nodeId of changed) if (this.stateProperties.has(nodeId)) this.pendingStateTargets.add(nodeId);
      for (const target of this.targetsFor(changed, this.stateProperties)) this.pendingStateTargets.add(target);
      const values = [];
      for (const nodeId of calculationTargets) {
        const calculation = this.calculations.get(nodeId);
        const value = this.evaluate("calculate", calculation.expression, nodeId, calculation.namespaces);
        if (value !== this.elements[nodeId].textContent) {
          this.elements[nodeId].textContent = value;
          values.push({ nodeId, value });
        }
      }
      if (values.length) {
        this.lastSubmissionSequence = sequence;
        submitCalculatedValues(sequence, values);
        return true;
      }
      const entries = [];
      for (const nodeId of [...this.pendingStateTargets].sort((left, right) => this.stateProperties.get(left).declarationIndex - this.stateProperties.get(right).declarationIndex)) {
        const definition = this.stateProperties.get(nodeId);
        const state = { relevant: true, readonly: false, required: false, constraint: true, datatype: true };
        for (const property of BOOLEAN_PROPERTIES) if (definition.properties[property]) state[property] = this.evaluate(property, definition.properties[property], nodeId, definition.namespaces);
        if (definition.datatype) state.datatype = root.XFormsPrimitiveTypeValidator.validate({ datatype: definition.datatype, namespaces: definition.namespaces, value: this.elements[nodeId].textContent }).valid;
        const valid = !state.relevant || ((!state.required || this.elements[nodeId].textContent.trim().length > 0) && state.constraint && state.datatype);
        const flags = flagsFor({ ...state, valid });
        if (flags !== this.projectedFlags.get(nodeId)) entries.push({ nodeId, flags });
        this.pendingStateTargets.delete(nodeId);
      }
      if (!entries.length) return false;
      this.lastSubmissionSequence = sequence;
      submitResolvedModelItemState(sequence, entries);
      return true;
    }
  }

  root.ConstrainedRecalculationError = ConstrainedRecalculationError;
  root.XFormsConstrainedRecalculator = XFormsConstrainedRecalculator;
})();
