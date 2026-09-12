// The file service.
//
// Supabase Storage did two jobs at once: it held the bytes, and it decided who
// could touch them. Cloud Storage only does the first. This service is the
// second job, written out.
//
// The rule it enforces is the same one the 13 Supabase storage policies
// enforced, and it is deliberately the whole rule:
//
//     the first folder of the path must be your own user id
//
// So `9f77c6d5-.../resume.pdf` belongs to that student and nobody else can read,
// replace or delete it. A request for `someone-else/resume.pdf` is refused
// before Cloud Storage is contacted at all.
//
// Bytes are proxied rather than handed out as signed URLs. Signing a URL means
// writing V4 signing by hand and then living with a link that keeps working
// after the person's session ends. Proxying is less code and the permission is
// checked on every single request. The files are small - the largest of the 32
// is under 200 KB - so the cost of passing them through is not worth trading a
// permission check for.
//
// The buckets are mounted as folders by Cloud Run, so this service reads and
// writes ordinary files and needs no credentials of its own. The first attempt
// called the Cloud Storage API with a token from the metadata server; on this
// runtime that server answers 404 for every service-account path, so there was
// no token to be had. Mounting removes the question entirely.
import { verifyGoogleToken } from './verify.ts';

const JWT_SECRET = Deno.env.get('PGRST_JWT_SECRET') ?? '';

const PORT = Number(Deno.env.get('PORT') ?? 8080);
const PRIVATE_BUCKET = Deno.env.get('PRIVATE_BUCKET') ?? 'prooflab-private-508214';
const PUBLIC_BUCKET = Deno.env.get('PUBLIC_BUCKET') ?? 'prooflab-public-508214';

/** Refuse anything larger. Matches the limit the upload screens already apply. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * The four Supabase buckets, and where each one now lives. profile-photos was
 * the only public bucket, so it is the only one in the public bucket here.
 */
const BUCKETS: Record<string, { bucket: string; public: boolean }> = {
  'proofs': { bucket: PRIVATE_BUCKET, public: false },
  'resumes': { bucket: PRIVATE_BUCKET, public: false },
  'voice-explanations': { bucket: PRIVATE_BUCKET, public: false },
  'profile-photos': { bucket: PUBLIC_BUCKET, public: true },
};

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://prooflaab.vercel.app')
  .split(',').map((s) => s.trim()).filter(Boolean);
const PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

function allowOrigin(origin: string | null): string {
  if (origin && (ALLOWED.includes(origin) || PREVIEW.test(origin))) return origin;
  return ALLOWED[0];
}

function headers(origin: string | null, extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': allowOrigin(origin),
    'Access-Control-Allow-Headers': 'authorization, content-type, x-upsert',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(origin, { 'Content-Type': 'application/json' }),
  });
}

// ---------------------------------------------------------------------------
// where the bytes actually live
// ---------------------------------------------------------------------------

const MOUNTS: Record<string, string> = {
  [PRIVATE_BUCKET]: Deno.env.get('PRIVATE_MOUNT') ?? '/mnt/private',
  [PUBLIC_BUCKET]: Deno.env.get('PUBLIC_MOUNT') ?? '/mnt/public',
};

const filePath = (bucket: string, object: string) => `${MOUNTS[bucket]}/${object}`;

// ---------------------------------------------------------------------------
// the rule
// ---------------------------------------------------------------------------

interface Target {
  bucket: string;
  object: string;
  isPublic: boolean;
}

/**
 * Work out what is being asked for, refusing anything malformed.
 *
 * Path traversal is refused rather than normalised. A caller with a legitimate
 * reason to write `a/../b` does not exist, and normalising quietly is how a
 * check gets bypassed: the guard sees one path and the storage layer another.
 */
function resolve(pathname: string): Target | { error: string } {
  const parts = pathname.replace(/^\/file\//, '').split('/');
  const alias = parts.shift() ?? '';
  const object = parts.join('/');

  const target = BUCKETS[alias];
  if (!target) return { error: 'unknown bucket' };
  if (!object) return { error: 'missing path' };
  if (object.includes('..') || object.startsWith('/') || object.includes('//')) {
    return { error: 'bad path' };
  }

  return { bucket: target.bucket, object: `${alias}/${object}`, isPublic: target.public };
}

/** The first folder of the path, which is the owner. */
function ownerOf(object: string): string {
  // object is "<alias>/<uid>/<rest>", so the owner is the second segment.
  return object.split('/')[1] ?? '';
}

// ---------------------------------------------------------------------------
// a grant, for the one case the folder rule cannot cover
// ---------------------------------------------------------------------------

/**
 * A college reviewing a student's proof is not the owner of that file, so the
 * "your own folder" rule would refuse them - correctly, because this service
 * has no idea who supervises whom.
 *
 * The proof-file-url function does know: it already checks, against 145 policies,
 * whether the caller may act on that piece of work. So it issues a grant - a
 * short-lived token naming exactly one object - and this service honours it.
 *
 * Three properties make that safe:
 *   - signed with the secret only our own services hold, so nobody else can
 *     write one
 *   - names one object, so it cannot be re-aimed at a different file
 *   - expires in minutes, so a link that leaks stops working
 */
async function grantAllows(token: string, object: string): Promise<boolean> {
  if (!JWT_SECRET) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const fromB64 = (s: string) => {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(fromB64(parts[1])));
  } catch {
    return false;
  }
  if (header.alg !== 'HS256') return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'HMAC', key, fromB64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return false;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return false;

  // The object is part of what was signed. A grant for one file is not a grant
  // for another.
  return payload.obj === object;
}

// ---------------------------------------------------------------------------
// requests
// ---------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin');
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
  if (url.pathname === '/healthz') return json({ ok: true }, 200, origin);
  if (!url.pathname.startsWith('/file/')) return json({ error: 'not found' }, 404, origin);

  const target = resolve(url.pathname);
  if ('error' in target) return json({ error: target.error }, 400, origin);

  // A public photo may be read by anyone; everything else needs a token first.
  const anonymousRead = req.method === 'GET' && target.isPublic;

  // A grant is read-only and covers exactly the object it names.
  const grant = url.searchParams.get('grant');
  const granted = req.method === 'GET' && grant !== null &&
    await grantAllows(grant, target.object);

  let caller = '';
  if (!anonymousRead && !granted) {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return json({ error: 'sign in first' }, 401, origin);

    const verified = await verifyGoogleToken(auth.slice(7).trim());
    if (!verified) return json({ error: 'invalid token' }, 401, origin);
    caller = verified.sub;

    if (ownerOf(target.object) !== caller) {
      // Same answer whether the file exists or not. Telling the caller which
      // one it was turns this endpoint into a way to discover other people's
      // filenames.
      return json({ error: 'not found' }, 404, origin);
    }
  }

  try {
    switch (req.method) {
      case 'GET':
        return await download(target, origin);
      case 'PUT':
        return await upload(req, target, origin);
      case 'DELETE':
        return await remove(target, origin);
      default:
        return json({ error: 'method not allowed' }, 405, origin);
    }
  } catch (err) {
    console.error(req.method, target.object, err);
    return json({ error: 'storage is unavailable' }, 502, origin);
  }
}

async function download(target: Target, origin: string | null): Promise<Response> {
  const path = filePath(target.bucket, target.object);

  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { read: true });
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return json({ error: 'not found' }, 404, origin);
    throw err;
  }

  return new Response(file.readable, {
    status: 200,
    headers: headers(origin, {
      'Content-Type': 'application/octet-stream',
      // Never inline. A PDF or an SVG rendered in the page's own origin can run
      // script; forcing a download keeps an uploaded file inert.
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
    }),
  });
}

async function upload(req: Request, target: Target, origin: string | null): Promise<Response> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BYTES) return json({ error: 'file is too large' }, 413, origin);

  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > MAX_BYTES) return json({ error: 'file is too large' }, 413, origin);
  if (body.byteLength === 0) return json({ error: 'file is empty' }, 400, origin);

  const path = filePath(target.bucket, target.object);

  // upsert:false is the app's default, and it matters: the proof upload screen
  // relies on a second write to the same path failing rather than overwriting.
  const upsert = req.headers.get('x-upsert') === 'true';
  if (!upsert) {
    try {
      await Deno.stat(path);
      return json({ error: 'a file already exists at that path' }, 409, origin);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }

  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await Deno.writeFile(path, body);

  // The path, echoed back the way supabase-js reports it.
  return json({ path: target.object.split('/').slice(1).join('/') }, 200, origin);
}

async function remove(target: Target, origin: string | null): Promise<Response> {
  try {
    await Deno.remove(filePath(target.bucket, target.object));
  } catch (err) {
    // Deleting something that is already gone is the outcome the caller wanted.
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return json({ deleted: true }, 200, origin);
}

if (import.meta.main) {
  console.log(`file service listening on :${PORT}`);
  Deno.serve({ port: PORT }, handler);
}

export { handler, ownerOf, resolve };
