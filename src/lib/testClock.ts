// TEST website only (owner, 27 Oct 2026): a season week lasts 5 minutes so squads and
// seasons can be tested in an hour. On only when the build sets VITE_TEST_FAST_WEEK=true
// (.env.staging); the REAL website build leaves it off and nothing changes there.
export const FAST_WEEK = import.meta.env.VITE_TEST_FAST_WEEK === "true";

// Match and swap times: in a 5-minute week the day alone says nothing, so add the time.
export const WHEN_FORMAT = FAST_WEEK ? "d MMM, h:mm a" : "d MMM";
