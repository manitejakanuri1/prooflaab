/**
 * File uploads, shaped like supabase.storage.
 *
 * The app calls `.from(bucket).upload(...)`, `.getPublicUrl(...)` and
 * `.remove([...])` in 13 places. Those keep working unchanged; underneath, the
 * bytes now go to the file service on Cloud Run, which checks that the folder
 * being written to belongs to the person writing to it - the same rule the 13
 * Supabase storage policies enforced.
 *
 * The token sent here is Google's own ID token, not the database token. The
 * file service verifies it against Google's rotating keys directly, so it never
 * has to trust anything this browser says about who the caller is.
 */

import { currentIdToken } from './identity';

const FILES_URL = import.meta.env.VITE_FILES_URL as string;
const PUBLIC_BUCKET = import.meta.env.VITE_PUBLIC_BUCKET as string;

interface StorageError {
  message: string;
  statusCode?: string;
}

interface Result<T> {
  data: T;
  error: StorageError | null;
}

function fail<T>(empty: T, message: string, status?: number): Result<T> {
  return { data: empty, error: { message, statusCode: status ? String(status) : undefined } };
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await currentIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Turn the service's JSON error into the sentence a person should read. */
async function messageFrom(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // Fall through to the generic message below.
  }
  if (res.status === 401) return 'Please sign in again';
  if (res.status === 409) return 'A file already exists at that path';
  if (res.status === 413) return 'That file is too large';
  return 'Could not reach file storage';
}

function bucketApi(bucket: string) {
  const base = `${FILES_URL}/file/${bucket}`;

  return {
    async upload(
      path: string,
      body: File | Blob | ArrayBuffer | Uint8Array,
      options?: { upsert?: boolean; contentType?: string },
    ): Promise<Result<{ path: string } | null>> {
      try {
        const res = await fetch(`${base}/${path}`, {
          method: 'PUT',
          headers: {
            ...(await authHeaders()),
            'Content-Type':
              options?.contentType ??
              (body instanceof File || body instanceof Blob
                ? body.type || 'application/octet-stream'
                : 'application/octet-stream'),
            ...(options?.upsert ? { 'x-upsert': 'true' } : {}),
          },
          body: body as BodyInit,
        });
        if (!res.ok) return fail(null, await messageFrom(res), res.status);
        return { data: (await res.json()) as { path: string }, error: null };
      } catch {
        return fail(null, 'Could not reach file storage');
      }
    },

    async remove(paths: string[]): Promise<Result<null>> {
      try {
        const headers = await authHeaders();
        const results = await Promise.all(
          paths.map((p) => fetch(`${base}/${p}`, { method: 'DELETE', headers })),
        );
        const refused = results.find((r) => !r.ok);
        if (refused) return fail(null, await messageFrom(refused), refused.status);
        return { data: null, error: null };
      } catch {
        return fail(null, 'Could not reach file storage');
      }
    },

    /**
     * Only meaningful for profile photos, the one bucket that is public. Cloud
     * Storage serves those directly, so the file service is not in the way of
     * every avatar on a page.
     */
    getPublicUrl(path: string): { data: { publicUrl: string } } {
      return {
        data: { publicUrl: `https://storage.googleapis.com/${PUBLIC_BUCKET}/${bucket}/${path}` },
      };
    },

    async download(path: string): Promise<Result<Blob | null>> {
      try {
        const res = await fetch(`${base}/${path}`, { headers: await authHeaders() });
        if (!res.ok) return fail(null, await messageFrom(res), res.status);
        return { data: await res.blob(), error: null };
      } catch {
        return fail(null, 'Could not reach file storage');
      }
    },

    /**
     * A private file cannot be handed out as a plain link, because the file
     * service checks a token on every request and an <img> or <a> sends none.
     * So the bytes are fetched with the token and wrapped in a blob: URL, which
     * behaves the same way in the page and stops working the moment the tab is
     * closed - a shorter life than a signed URL, not a longer one.
     *
     * The caller should release it with URL.revokeObjectURL when finished.
     */
    async createSignedUrl(path: string, _expiresIn?: number): Promise<Result<{ signedUrl: string } | null>> {
      const { data, error } = await this.download(path);
      if (error || !data) return fail(null, error?.message ?? 'Could not open that file');
      return { data: { signedUrl: URL.createObjectURL(data) }, error: null };
    },
  };
}

export const googleStorage = {
  from: bucketApi,
};
