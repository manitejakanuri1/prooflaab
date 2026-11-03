// TEST website only: a season week lasts 10 minutes (20 from 31 Oct to 2 Nov 2026 under migration 208, now rolled back) so
// squads and seasons can be tested in about two hours. Must match the TEST database clock (test_fast_season). On only when the build sets VITE_TEST_FAST_WEEK=true
// (.env.staging); the REAL website build leaves it off and nothing changes there.
export const FAST_WEEK = import.meta.env.VITE_TEST_FAST_WEEK === "true";
export const FAST_WEEK_MINUTES = 10;

// Match and swap times: in a short week the day alone says nothing, so add the time.
export const WHEN_FORMAT = FAST_WEEK ? "d MMM, h:mm a" : "d MMM";
