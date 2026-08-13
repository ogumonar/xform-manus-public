#!/usr/bin/env node
/* Real-Chromium smoke checks for the public XForm Revival demo. */
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const serverScript = path.join(root, "tests/static-server.js");
const browser = process.env.CHROMIUM_BIN || "chromium";
const checks = [
  {
    url: "http://127.0.0.1:4173/",
    expected: "Adapter upgraded 2 XForms presentation elements.",
    name: "Public runtime landing page"
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
    expected: "PASS: Web Components project XForms control state and emit safe, typed intents.",
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
  console.error("FAIL: test server did not start in time.");
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
  console.error(`FAIL: unable to start the test server: ${error.message}`);
  process.exitCode = 1;
});

process.on("exit", stopServer);
