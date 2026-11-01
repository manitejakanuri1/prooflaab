// E2E-25: a skill counts as claimed only on whole words, so Java is not JavaScript.
import { assertEquals } from "jsr:@std/assert@1";
import { skillPresent } from "./role-skills.ts";

Deno.test("skillPresent matches whole words only", () => {
  assertEquals(skillPresent(["Java"], "JavaScript"), false);
  assertEquals(skillPresent(["JavaScript"], "Java"), false);
  assertEquals(skillPresent(["C++"], "C"), false);
  assertEquals(skillPresent(["Spring Boot framework"], "Spring Boot"), true);
  assertEquals(skillPresent(["spring"], "Spring Boot"), true);
  assertEquals(skillPresent(["python 3"], "Python"), true);
});
