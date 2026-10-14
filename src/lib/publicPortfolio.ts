/**
 * The signed-out read of a published portfolio (web-bff/publicRoutes.ts).
 *
 * Returns null for anything that is not a published portfolio: unknown, private
 * and failed lookups look the same on purpose. No cookie is sent - the answer
 * is the same for everyone.
 */
export interface PublicWork {
  task_id: string;
  title: string;
  category: string | null;
  kind: "code" | "written";
  language: string | null;
  score: number | null;
  passed_count: number | null;
  total_count: number | null;
  passed_at: string;
  explanation_score: number | null;
  set_by: string | null;
}

export interface PublicPortfolio {
  slug: string;
  bio: string | null;
  skills: string[];
  achievements: string | null;
  is_public: true;
  student_profiles: {
    full_name: string;
    profile_photo_url: string | null;
    total_xp: number;
  };
  work: PublicWork[];
}

export async function fetchPublicPortfolio(
  slug: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicPortfolio | null> {
  const response = await fetcher(
    `/api/public/portfolio/${encodeURIComponent(slug)}`,
    { credentials: "omit", headers: { Accept: "application/json" } },
  );

  // A signed-out site that does not route /api answers with the app's HTML page.
  if (
    !response.ok ||
    !(response.headers.get("content-type") ?? "").includes("application/json")
  ) {
    return null;
  }

  const body = await response.json();

  if (!body || typeof body !== "object" || !Array.isArray(body.work)) {
    return null;
  }

  return {
    slug: body.slug,
    bio: body.bio ?? null,
    skills: Array.isArray(body.skills) ? body.skills : [],
    achievements: body.achievements ?? null,
    is_public: true,
    student_profiles: {
      full_name: body.full_name ?? "Student",
      profile_photo_url: body.profile_photo_url ?? null,
      total_xp: body.total_xp ?? 0,
    },
    work: body.work,
  };
}
