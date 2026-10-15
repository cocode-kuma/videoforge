import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHtmlSyntax } from "../plugins/cocode-director/validate.js";
test("free model HTML keeps arbitrary valid JS; syntax errors are rejected", async () => {
  await validateHtmlSyntax(
    '<html><style>canvas{position:fixed;inset:0}</style><canvas/><script>const gl=document.querySelector("canvas").getContext("webgl");fetch("https://example.com/asset");window.customEffect=()=>gl.clear(0);</script></html>',
  );
  await validateHtmlSyntax(
    '<script type="module">import * as THREE from "https://example.com/three.js";export const scene=new THREE.Scene();</script>',
  );
  await assert.rejects(validateHtmlSyntax("<script>const = broken;</script>"));
});
