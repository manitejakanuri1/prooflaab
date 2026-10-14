/**
 * Storage surface shaped like supabase.storage.
 *
 * Private upload/download/delete requests now go through the same-origin web
 * BFF. The browser sends no application bearer token; the BFF resolves the
 * opaque HttpOnly session and injects the authenticated server-side token.
 *
 * Public profile-photo URLs remain direct Cloud Storage URLs because they are
 * intentionally public and require no authenticated proxy.
 */

import {
  bffFileFetch,
  bffFileUrl,
} from "./bffFiles";

const PUBLIC_BUCKET =
  import.meta.env.VITE_PUBLIC_BUCKET as string;

interface StorageError {
  message: string;
  statusCode?: string;
}

interface Result<T> {
  data: T;
  error: StorageError | null;
}

function fail<T>(
  empty: T,
  message: string,
  status?: number,
): Result<T> {
  return {
    data: empty,
    error: {
      message,
      statusCode:
        status ? String(status) : undefined,
    },
  };
}

/** Turn the BFF/service JSON error into the sentence a person should read. */
async function messageFrom(
  res: Response,
): Promise<string> {
  try {
    const body =
      (await res.json()) as { error?: string };

    if (body.error) return body.error;
  } catch {
    // Fall through to the safe generic messages below.
  }

  if (res.status === 401) {
    return "Please sign in again";
  }

  if (res.status === 409) {
    return "A file already exists at that path";
  }

  if (res.status === 413) {
    return "That file is too large";
  }

  return "Could not reach file storage";
}

function bucketApi(bucket: string) {
  return {
    async upload(
      path: string,
      body:
        | File
        | Blob
        | ArrayBuffer
        | Uint8Array,
      options?: {
        upsert?: boolean;
        contentType?: string;
      },
    ): Promise<
      Result<{ path: string } | null>
    > {
      try {
        const res = await bffFileFetch(
          bffFileUrl(bucket, path),
          {
            method: "PUT",
            headers: {
              "Content-Type":
                options?.contentType ??
                (
                  body instanceof File ||
                    body instanceof Blob
                    ? body.type ||
                      "application/octet-stream"
                    : "application/octet-stream"
                ),
              ...(options?.upsert
                ? { "x-upsert": "true" }
                : {}),
            },
            body: body as BodyInit,
          },
        );

        if (!res.ok) {
          return fail(
            null,
            await messageFrom(res),
            res.status,
          );
        }

        return {
          data:
            (await res.json()) as {
              path: string;
            },
          error: null,
        };
      } catch {
        return fail(
          null,
          "Could not reach file storage",
        );
      }
    },

    async remove(
      paths: string[],
    ): Promise<Result<null>> {
      try {
        const results =
          await Promise.all(
            paths.map((path) =>
              bffFileFetch(
                bffFileUrl(bucket, path),
                { method: "DELETE" },
              )
            ),
          );

        const refused =
          results.find((res) => !res.ok);

        if (refused) {
          return fail(
            null,
            await messageFrom(refused),
            refused.status,
          );
        }

        return {
          data: null,
          error: null,
        };
      } catch {
        return fail(
          null,
          "Could not reach file storage",
        );
      }
    },

    /**
     * Public profile images remain directly cacheable from Cloud Storage.
     */
    getPublicUrl(
      path: string,
    ): {
      data: {
        publicUrl: string;
      };
    } {
      return {
        data: {
          publicUrl:
            `https://storage.googleapis.com/${PUBLIC_BUCKET}/${bucket}/${path}`,
        },
      };
    },

    async download(
      path: string,
    ): Promise<
      Result<Blob | null>
    > {
      try {
        const res = await bffFileFetch(
          bffFileUrl(bucket, path),
          { method: "GET" },
        );

        if (!res.ok) {
          return fail(
            null,
            await messageFrom(res),
            res.status,
          );
        }

        return {
          data: await res.blob(),
          error: null,
        };
      } catch {
        return fail(
          null,
          "Could not reach file storage",
        );
      }
    },

    /**
     * Private files stay private. Fetch their bytes through the BFF and expose
     * only a short-lived browser blob URL to the existing UI.
     */
    async createSignedUrl(
      path: string,
      _expiresIn?: number,
    ): Promise<
      Result<{ signedUrl: string } | null>
    > {
      const {
        data,
        error,
      } = await this.download(path);

      if (error || !data) {
        return fail(
          null,
          error?.message ??
            "Could not open that file",
        );
      }

      return {
        data: {
          signedUrl:
            URL.createObjectURL(data),
        },
        error: null,
      };
    },
  };
}

export const googleStorage = {
  from: bucketApi,
};
