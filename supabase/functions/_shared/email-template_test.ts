import { renderOverride } from "./email-template.ts";

const assert = (ok: boolean, why: string) => {
  if (!ok) throw new Error(why);
};

Deno.test("admin wording is used, with the name filled in", () => {
  const out = renderOverride({ subject: "Hello {{name}}", intro: "Welcome {{name}}.\n\nSecond paragraph." }, "Asha", "https://prooflab.co.in/auth", "Sign in");
  assert(out.subject === "Hello Asha", "subject");
  assert(out.html.includes("Welcome Asha.") && out.html.includes("Second paragraph."), "intro");
  assert((out.html.match(/<p style="color/g) ?? []).length === 2, "two paragraphs");
  assert(out.html.includes('href="https://prooflab.co.in/auth"') && out.html.includes(">Sign in<"), "button");
});

Deno.test("nothing an admin or a name contains becomes markup or a header", () => {
  const out = renderOverride(
    { subject: "Hi\r\nBcc: x@y.z", intro: '<script>alert(1)</script> <a href="https://evil.example">x</a> {{name}}' },
    "<b>$&</b>",
    'https://prooflab.co.in/auth"><img src=x>',
    "Go",
  );
  assert(!/[\r\n]/.test(out.subject), "subject is one line");
  assert(!out.html.includes("<script>") && !out.html.includes("<b>") && !out.html.includes("<img"), "escaped");
  assert((out.html.match(/<a /g) ?? []).length === 1, "the only link is the button");
  assert(out.html.includes("&lt;b&gt;$&amp;&lt;/b&gt;"), "name kept literally");
});
