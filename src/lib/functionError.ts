/**
 * Read the JSON body of a failed edge-function call.
 *
 * supabase.functions.invoke throws on any non-2xx and hands back only a generic
 * "Edge Function returned a non-2xx status code" message, so a function that
 * carefully explained itself in the response body has that explanation thrown
 * away. The original Response is on error.context; this gets the body back.
 */
export async function readFunctionError(error: unknown): Promise<Record<string, unknown> | null> {
  const context = (error as { context?: Response })?.context;
  if (!context || typeof context.json !== "function") return null;
  try {
    return await context.clone().json();
  } catch {
    return null;
  }
}
