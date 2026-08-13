#!/usr/bin/env node
/*
 * Minimal real-Chromium end-to-end smoke test for the Rust/Wasm worker harness.
 * It intentionally uses the system Chromium binary instead of downloading a
 * second browser through Playwright or Puppeteer, keeping the Dev Container small.
 */
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const serverScript = path.join(root, "packages/browser-extension/tests/static-server.js");
const url = "http://127.0.0.1:4173/packages/browser-extension/tests/wasm-worker.html";
const browser = process.env.CHROMIUM_BIN || "chromium";

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
  const result = spawnSync(browser, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--virtual-time-budget=5000",
    "--dump-dom",
    url
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000
  });

  stopServer();

  if (result.error) {
    console.error(`FAIL: unable to launch ${browser}: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) {
    console.error(result.stderr || `FAIL: ${browser} exited with status ${result.status}.`);
    process.exitCode = 1;
    return;
  }
  if (!result.stdout.includes("PASS: Wasm worker propagated")) {
    console.error("FAIL: Chromium loaded the harness, but the Wasm worker assertion did not pass.");
    console.error(result.stdout);
    process.exitCode = 1;
    return;
  }
  console.log("PASS: real Chromium executed the Wasm worker harness successfully.");
});

server.once("error", (error) => {
  clearTimeout(timer);
  console.error(`FAIL: unable to start the test server: ${error.message}`);
  process.exitCode = 1;
});

process.on("exit", stopServer);
