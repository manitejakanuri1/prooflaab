import { guideGapPrompt, parseGuideGaps } from "./guide-gaps.ts";

Deno.test("parseGuideGaps: reads the missing list (MF-015)", () => {
  const got = parseGuideGaps('{"missing": ["the monthly rent", "  ", 5]}');
  if (got.length !== 1 || got[0] !== "the monthly rent") throw new Error(JSON.stringify(got));
});

Deno.test("parseGuideGaps: an empty list or unreadable reply means nothing is missing", () => {
  if (parseGuideGaps('{"missing": []}').length !== 0) throw new Error("empty list");
  if (parseGuideGaps("not json").length !== 0) throw new Error("bad reply");
  if (parseGuideGaps('```json\n{"missing": ["x"]}\n```').join() !== "x") throw new Error("fenced reply");
});

Deno.test("guideGapPrompt: carries the task and every criterion, and says answers do not count", () => {
  const p = guideGapPrompt("Your task: price the order.", [{ name: "Total", description: "States Rs 4500." }]);
  for (const want of ["Your task: price the order.", "1. Total: States Rs 4500.", "answers, results or conclusions"]) {
    if (!p.includes(want)) throw new Error("missing " + want);
  }
});
