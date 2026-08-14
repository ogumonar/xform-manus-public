#!/usr/bin/env node
/*
 * Real-Chromium smoke checks for the public XForm Revival runtime demo.
 * The landing page and all harnesses use this repository's root HTTP origin.
 */
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const serverScript = path.join(root, "tests/static-server.js");
const browser = process.env.CHROMIUM_BIN || "chromium";
const checks = [
  {
    url: "http://127.0.0.1:4173/",
    expected: "Live automatically ref-bound control",
    name: "Public automatic-ref landing page"
  },
  {
    url: "http://127.0.0.1:4173/tests/auto-control-ref-binding-smoke.html",
    expected: "PASS: xforms-host binds eligible unambiguous control refs through the worker.",
    name: "Automatic control-ref binding harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/simple-path-query-smoke.html",
    expected: "PASS: Worker resolves strict simple paths over hydrated inline XML.",
    name: "Simple path worker query harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/discovery-worker-hydration-smoke.html",
    expected: "PASS: xforms-host discovers one inline model and hydrates the worker.",
    name: "Discovery-to-worker hydration harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/inline-instance-worker-smoke.html",
    expected: "PASS: Worker hydrates inline XML into a complete initial component snapshot.",
    name: "Inline instance worker hydration harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/primitive-type-validation-smoke.html",
    expected: "PASS: Primitive type validation projects invalid, valid, and unsupported-type outcomes.",
    name: "Primitive type validation harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/constrained-reset-action-smoke.html",
    expected: "PASS: Direct reset action restores the worker hydration baseline through a full snapshot.",
    name: "Constrained reset action harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/constrained-setfocus-action-smoke.html",
    expected: "PASS: Direct setfocus actions delegate focus through the target component.",
    name: "Constrained setfocus action harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/constrained-toggle-action-smoke.html",
    expected: "PASS: Direct toggle actions update switch case projection without worker mutation.",
    name: "Constrained toggle action harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/constrained-setindex-action-smoke.html",
    expected: "PASS: Direct setindex actions update one projected repeat index without worker mutation.",
    name: "Constrained setindex action harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/constrained-setvalue-action-smoke.html",
    expected: "PASS: Direct trigger setvalue actions resolve one target and mutate through the worker.",
    name: "Constrained setvalue action harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/discovered-repeat-projection-smoke.html",
    expected: "PASS: Discovered collection binding projects keyed repeat occurrences without component XML ownership.",
    name: "Discovered repeat projection harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/adapted-repeat-occurrence-context-smoke.html",
    expected: "PASS: Adapted repeat template controls bind to occurrence-local worker targets.",
    name: "Adapted repeat occurrence context harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/repeat-occurrence-context-smoke.html",
    expected: "PASS: Repeat occurrence context binds cloned controls to proven local compact targets.",
    name: "Repeat occurrence context harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/repeat-component-smoke.html",
    expected: "PASS: Keyed repeat projection preserves occurrences and emits one-based index events.",
    name: "Repeat component harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/constrained-model-item-state-recalculation-smoke.html",
    expected: "PASS: Constrained recalculation submits resolved model-item state after source intents.",
    name: "Constrained model-item state recalculation harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/resolved-model-item-state-submission-smoke.html",
    expected: "PASS: Sequenced resolved model-item state re-enters the worker patch flow.",
    name: "Resolved model-item state submission harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/constrained-recalculation-smoke.html",
    expected: "PASS: Constrained browser-model recalculation submits calculated patches after source intents.",
    name: "Constrained recalculation harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/calculated-value-submission-smoke.html",
    expected: "PASS: Sequenced calculated values re-enter the worker mutation and patch flow.",
    name: "Calculated value submission harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/static-dependency-hydration-smoke.html",
    expected: "PASS: Opt-in static dependencies register during discovered-model worker hydration.",
    name: "Static dependency hydration harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/static-dependency-extractor-smoke.html",
    expected: "PASS: Static dependency extraction emits proven compact edges and flags unsupported XPath references.",
    name: "Static dependency extractor harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/initial-bind-execution-smoke.html",
    expected: "PASS: Opt-in initial bind execution projects calculated values and model-item state before worker hydration.",
    name: "Initial bind execution harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/bind-target-resolution-smoke.html",
    expected: "PASS: Discovered bind targets resolve to ordered compact element IDs through the browser model adapter.",
    name: "Bind target resolution harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/model-discovery-smoke.html",
    expected: "PASS: XForms model discovery emits validated DOM-free declarations.",
    name: "XForms model discovery harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/xforms-property-evaluator-smoke.html",
    expected: "PASS: Typed XForms property evaluation preserves the XPath 1.0 boundary and explicit singleton context.",
    name: "XForms property evaluator harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/xpath-compatibility-smoke.html",
    expected: "PASS: XPath 1.0 compatibility gate and browser evaluator probe passed.",
    name: "XPath 1.0 compatibility harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/hydration-smoke.html",
    expected: "PASS: Worker hydrates initial values and model-item state before first interaction.",
    name: "Initial projection hydration harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/adapter-smoke.html",
    expected: "PASS: XForms markup adapter upgrades the supported static component subset.",
    name: "XForms markup adapter harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/components-smoke.html",
    expected: 'data-harness-status="pass"',
    name: "Web Component harness"
  },
  {
    url: "http://127.0.0.1:4173/tests/wasm-worker.html",
    expected: "PASS: Wasm worker propagated one source mutation through a four-node dependency graph.",
    name: "Wasm worker harness"
  }
];

const server = spawn(process.execPath, [serverScript], {
  cwd: root,
  stdio: ["ignore", "pipe", "inherit"]
});

const stopServer = () => {
  if (!server.killed) server.kill("SIGTERM");
};

const timer = setTimeout(() => {
  stopServer();
  console.error("FAIL: public test server did not start in time.");
  process.exit(1);
}, 5000);

server.stdout.once("data", () => {
  clearTimeout(timer);
  for (const check of checks) {
    const result = spawnSync(browser, [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--virtual-time-budget=5000",
      "--dump-dom",
      check.url
    ], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000
    });
    if (result.error) {
      stopServer();
      console.error(`FAIL: unable to launch ${browser}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }
    if (result.status !== 0) {
      stopServer();
      console.error(result.stderr || `FAIL: ${check.name} exited with status ${result.status}.`);
      process.exitCode = 1;
      return;
    }
    if (!result.stdout.includes(check.expected)) {
      stopServer();
      console.error(`FAIL: ${check.name} loaded, but its assertion did not pass.`);
      console.error(result.stdout);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS: ${check.name} executed successfully in Chromium.`);
  }
  stopServer();
});

server.once("error", (error) => {
  clearTimeout(timer);
  console.error(`FAIL: unable to start the public test server: ${error.message}`);
  process.exitCode = 1;
});

process.on("exit", stopServer);
