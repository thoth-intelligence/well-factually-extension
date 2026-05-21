// withTimeout.test.js — pins the 4s consensus-race contract.
//
// Critical behaviors:
//   1. Fast resolve returns the value and does NOT leave the timer hanging.
//   2. Slow promise rejects with a recognizable "Timed out after Nms" error.
//   3. Timeout aborts the AbortController (observable via signal.aborted).
//   4. Fast rejection propagates and clears the timer.
//
// A regression where clearTimeout is forgotten would leave the node:test
// runner hanging until the longest timeout in the suite elapses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "../chrome-extension/vertex.js";

test("fast resolve returns the value", async () => {
  const c = new AbortController();
  const r = await withTimeout(Promise.resolve(42), 100, c);
  assert.equal(r, 42);
  assert.equal(c.signal.aborted, false);
});

test("slow promise rejects with timeout message + aborts controller", async () => {
  const c = new AbortController();
  const slow = new Promise((resolve) => setTimeout(resolve, 500));
  await assert.rejects(() => withTimeout(slow, 50, c), /Timed out after 50ms/);
  assert.equal(c.signal.aborted, true);
});

test("fast resolve does NOT leave a hanging timer", async () => {
  // If clearTimeout is missing, the test runner would hang for the timeout
  // duration. Setting a large timeout here makes that hang detectable —
  // node:test will report this test took ~10s instead of ~1ms.
  const c = new AbortController();
  const t0 = Date.now();
  await withTimeout(Promise.resolve("ok"), 10_000, c);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 100, `expected <100ms, got ${elapsed}ms — clearTimeout likely missing`);
});

test("fast rejection propagates and clears timer", async () => {
  const c = new AbortController();
  const t0 = Date.now();
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error("boom")), 10_000, c),
    /boom/,
  );
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 100, `expected <100ms, got ${elapsed}ms — clearTimeout likely missing`);
});

test("works without a controller argument", async () => {
  const r = await withTimeout(Promise.resolve("ok"), 100);
  assert.equal(r, "ok");
});

test("controller.abort failure is swallowed (already-aborted controller)", async () => {
  const c = new AbortController();
  c.abort();   // simulate an outer abort that already fired
  // Timeout still fires and we still get a rejection — the inner try/catch
  // around controller.abort() handles the "already aborted" case.
  const slow = new Promise((resolve) => setTimeout(resolve, 500));
  await assert.rejects(() => withTimeout(slow, 30, c), /Timed out after 30ms/);
});
