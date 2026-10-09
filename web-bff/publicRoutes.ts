import { bridgeServiceToken } from "./serviceToken.ts";

/*
 * The one thing a signed-out visitor may read: a portfolio its owner published.
 *
 * The general /api/db proxy stays closed to anonymous callers. This route does
 * not proxy: it asks the database two fixed questions with the BFF's own
 * credential and copies named fields into the answer. Nothing the browser
 * sends, apart from the slug, reaches the database.
 *
 * Shown only when ALL of these hold (the database applies them):
 *   - the portfolio is switched on (is_public),
 *   - the student chose "Anyone with the link" (profile_visibility = public),
 *   - the student account is active.
 *
 * Every other outcome - private, unknown, suspended, a database error - is the
 * same 404, so the answer never tells a stranger whether an account exists.
 *
 * Left out on purpose: the student id, contact details, college, recordings and
 * the resume scorecard (migration stage 48 keeps scores for signed-in viewers).
 */

interface Env {
  get(name: string): string | undefined;
}

export interface PublicRouteDeps {
  env?: Env;
  fetcher?: typeof fetch;
  serviceToken?: () => Promise<string>;
}

const PREFIX = "/api/public";
const PORTFOLIO = /^\/api\/public\/portfolio\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/;
const UPSTREAM_TIMEOUT_MS = 5000;

const PORTFOLIO_SELECT = "student_id,slug,bio,skills,achievements," +
  "student_profiles!inner(full_name,profile_photo_url,total_xp)";

const WORK_FIELDS = [
  "task_id",
  "title",
  "category",
  "kind",
  "language",
  "score",
  "passed_count",
  "total_count",
  "passed_at",
  "explanation_score",
  "set_by",
] as const;

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function json(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

const notFound = () => json({ error: "not found" }, 404);

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => typeof value === "string" ? value : null;

async function readPortfolio(
  slug: string,
  deps: PublicRouteDeps,
): Promise<Row | null> {
  const env = deps.env ?? Deno.env;
  const fetcher = deps.fetcher ?? fetch;
  const postgrest = (env.get("POSTGREST_URL") ?? "").replace(/\/+$/, "");

  if (!postgrest) return null;

  const token = await (deps.serviceToken ??
    (() => bridgeServiceToken(env, fetcher)))();

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const query = new URLSearchParams({
    select: PORTFOLIO_SELECT,
    slug: `eq.${slug}`,
    is_public: "eq.true",
    "student_profiles.status": "eq.active",
    "student_profiles.profile_visibility": "eq.public",
    limit: "1",
  });

  const found = await fetcher(`${postgrest}/student_portfolios?${query}`, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!found.ok) return null;

  const rows: unknown = await found.json();
  const row = Array.isArray(rows) ? rows[0] : null;

  if (!isRow(row) || !isRow(row.student_profiles)) return null;

  const studentId = text(row.student_id);

  if (!studentId) return null;

  // portfolio_work() checks is_public itself and returns no code or answers.
  const worked = await fetcher(`${postgrest}/rpc/portfolio_work`, {
    method: "POST",
    headers,
    body: JSON.stringify({ _student_id: studentId }),
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!worked.ok) return null;

  const work: unknown = await worked.json();

  if (!Array.isArray(work)) return null;

  const profile = row.student_profiles;
  const photo = text(profile.profile_photo_url);

  return {
    slug,
    bio: text(row.bio),
    skills: Array.isArray(row.skills)
      ? row.skills.filter((skill) => typeof skill === "string")
      : [],
    achievements: text(row.achievements),
    full_name: text(profile.full_name),
    profile_photo_url: photo?.startsWith("https://") ? photo : null,
    total_xp: typeof profile.total_xp === "number" ? profile.total_xp : 0,
    work: work.filter(isRow).map((item) =>
      Object.fromEntries(WORK_FIELDS.map((field) => [field, item[field] ?? null]))
    ),
  };
}

export async function handlePublicRoute(
  req: Request,
  deps: PublicRouteDeps = {},
): Promise<Response | null> {
  const { pathname } = new URL(req.url);

  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) {
    return null;
  }

  // The raw path is matched, so an encoded slug (%2F, %26 ...) never matches.
  const match = PORTFOLIO.exec(pathname);

  if (!match) return notFound();

  if (req.method !== "GET") {
    return json({ error: "method not allowed" }, 405, { Allow: "GET" });
  }

  // ponytail: no per-caller rate limit here (the BFF has none anywhere). Each
  // call costs two indexed reads; add a limiter if this route is ever abused.
  try {
    const portfolio = await readPortfolio(match[1], deps);

    return portfolio ? json(portfolio, 200) : notFound();
  } catch {
    return notFound();
  }
}
