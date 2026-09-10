/**
 * How many rows a dashboard list will fetch at most.
 *
 * These screens were written with no limit at all. Row-level security keeps a
 * caller to their own scope, so "no limit" meant one student's own handful of
 * rows - and every student, proof and task in the college for a TPO, or on the
 * platform for an admin. At the fixture's size that is invisible. At one
 * college of five hundred students it is tens of thousands of rows crossing the
 * wire to fill a table nobody scrolls to the bottom of, against an 8 second
 * statement_timeout on the `authenticated` role.
 *
 * Every capped query is ordered newest-first, so the cap keeps the rows that
 * matter and drops the tail.
 *
 * ponytail: a flat cap, not pagination. The screens show "most recent N" and
 * have no next-page control to drive; when a college actually needs to page
 * through its whole roster, these become range() calls with a page control and
 * this constant becomes the page size.
 */
export const ADMIN_LIST_CAP = 500;
