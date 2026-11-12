/** P7g: "1 student", "2 students", "1,200 students" (Indian digit grouping). */
export function plural(n: number | null | undefined, one: string, many = `${one}s`): string {
  const v = Number(n) || 0;
  return `${v.toLocaleString("en-IN")} ${v === 1 ? one : many}`;
}
