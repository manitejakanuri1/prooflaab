import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/functionError";

/**
 * Opening the file attached to a proof.
 *
 * Uploaded files live in a private bucket, so there is no URL that can simply be
 * put in an href — every view has to ask for a signed one. This is that ask, in
 * one place, so a page cannot accidentally invent its own weaker rule about who
 * may see a proof.
 */

export interface ProofFileRef {
  id: string;
  file_url?: string | null;
  file_path?: string | null;
  file_name?: string | null;
}

/**
 * Submissions from before files were really uploaded.
 *
 * The old modal wrote "[FILE: report.pdf (application/pdf, 12345 bytes)]" into
 * file_url. There is no file behind those, and rendering one as a link gives a
 * reviewer a dead href that looks like the platform is broken. They are
 * recognised here so the UI can say what actually happened.
 */
const LEGACY_FAKE_FILE = /^\[FILE:/;

export function isLegacyPlaceholder(ref: Pick<ProofFileRef, "file_url">): boolean {
  return !!ref.file_url && LEGACY_FAKE_FILE.test(ref.file_url.trim());
}

/** True when there is something a reviewer can actually open. */
export function hasOpenableProof(ref: ProofFileRef): boolean {
  return !!ref.file_path || (!!ref.file_url && !isLegacyPlaceholder(ref));
}

/** What to call the attachment in the UI. */
export function proofFileLabel(ref: ProofFileRef): string {
  if (ref.file_path) return ref.file_name ?? ref.file_path.split("/").pop() ?? "Uploaded file";
  if (isLegacyPlaceholder(ref)) {
    const match = ref.file_url!.match(/^\[FILE:\s*([^(]+)/);
    return match ? match[1].trim() : "File (not stored)";
  }
  return ref.file_url ?? "No attachment";
}

/**
 * Either a URL to open or a reason there is none.
 *
 * One flat shape rather than a discriminated union on `ok`: this project builds
 * with `strict: false`, so boolean literal types collapse and `if (!result.ok)`
 * does not narrow. Checking `error` first works either way.
 */
export interface ResolvedProofFile {
  url?: string;
  /** A pasted link opens directly; an upload needs a signed URL that expires. */
  kind?: "link" | "file";
  error?: string;
  /** There is no file at all — retrying will not help. */
  missing?: boolean;
}

/**
 * Turn a proof into something openable, or explain why it cannot be.
 *
 * Never throws: every caller of this is a click handler, and an unhandled
 * rejection there is a button that silently does nothing.
 */
export async function resolveProofFile(ref: ProofFileRef): Promise<ResolvedProofFile> {
  if (isLegacyPlaceholder(ref)) {
    return {
      error:
        "This submission was made before file uploads were stored, so there is no file to open. Ask the student to re-submit it.",
      missing: true,
    };
  }

  if (ref.file_path) {
    try {
      const { data, error } = await supabase.functions.invoke("proof-file-url", {
        body: { proof_id: ref.id },
      });
      if (error) {
        const body = await readFunctionError(error);
        return {
          error: String(body?.error ?? "Could not open this file."),
          missing: !!body?.no_file,
        };
      }
      return { url: data.url as string, kind: "file" };
    } catch {
      return { error: "Could not open this file." };
    }
  }

  if (ref.file_url) return { url: ref.file_url, kind: "link" };

  return { error: "This submission has no attachment.", missing: true };
}
