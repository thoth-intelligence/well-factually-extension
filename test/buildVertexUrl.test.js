// buildVertexUrl.test.js — pins both branches of the URL builder.
//
// v0.5.1: projectId is now encodeURIComponent'd before interpolation
// (security finding Sec1). The regional branch is dead code today (the
// 2026-05-21 addendum moved Llama from us-east5 to global), but kept in
// the registry for future regional voices — so we pin both shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVertexUrl } from "../chrome-extension/vertex.js";

test("global URL — no region prefix on host, 'global' in path", () => {
  const u = buildVertexUrl({ region: "global" }, "my-project");
  assert.equal(
    u,
    "https://aiplatform.googleapis.com/v1beta1/projects/my-project/locations/global/endpoints/openapi/chat/completions",
  );
});

test("regional URL — region prefixes host AND embeds in path", () => {
  const u = buildVertexUrl({ region: "us-east5" }, "my-project");
  assert.equal(
    u,
    "https://us-east5-aiplatform.googleapis.com/v1beta1/projects/my-project/locations/us-east5/endpoints/openapi/chat/completions",
  );
});

test("projectId is encodeURIComponent'd (Sec1 mitigation)", () => {
  const u = buildVertexUrl({ region: "global" }, "evil/locations/global/endpoints?x=");
  // Forward slashes, equals, question marks all percent-encoded so they
  // can't redirect the request to a different Google API path/query.
  assert.ok(!u.includes("evil/locations/global/endpoints?x="),
    `unsafe project ID not encoded: ${u}`);
  assert.match(u, /evil%2Flocations%2Fglobal%2Fendpoints%3Fx%3D/);
});

test("encoded projectId still lands on aiplatform.googleapis.com", () => {
  const u = buildVertexUrl({ region: "global" }, "../foo");
  const url = new URL(u);
  assert.equal(url.hostname, "aiplatform.googleapis.com");
});
