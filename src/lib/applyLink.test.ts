import assert from "node:assert/strict";
import test from "node:test";
import { applyHost } from "./applyLink.ts";

test("only plain https links get an Apply button", () => {
  assert.equal(applyHost("https://careers.acme.com/jobs/1?x=2"), "careers.acme.com");
  assert.equal(applyHost("https://acme.in"), "acme.in");
  for (const bad of [null, "", "http://acme.com", "javascript:alert(1)", "https://good.com@evil.com/x",
                     "https://localhost/x", "ftp://acme.com", " https://acme.com", "https://acme.com/a b"]) {
    assert.equal(applyHost(bad), null, String(bad));
  }
});
