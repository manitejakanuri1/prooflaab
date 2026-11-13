// Admin times are always shown in India time with an "IST" label, whatever the viewer's computer clock is set to.
const IST_SECONDS = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
});

/** Retest 3: same format as fmtDayTime ("11 Nov 2026, 4:14 pm IST"); `seconds` adds the seconds. */
export function fmtIST(iso: string | number | Date, seconds = false): string {
  return seconds ? `${IST_SECONDS.format(new Date(iso))} IST` : fmtDayTime(new Date(iso).toISOString());
}

const IST_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const IST_DAY_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
});

/** Sweep M13: one date format everywhere, in India time: "11 Nov 2026". */
export function fmtDay(iso: string | number | Date | null | undefined): string {
  return iso == null || iso === "" ? "—" : IST_DAY.format(new Date(iso));
}

/** Sweep M12: one time everywhere, in India time whatever the viewer's clock says: "11 Nov 2026, 4:14 pm IST". */
export function fmtDayTime(iso: string | number | Date | null | undefined): string {
  return iso == null || iso === "" ? "—" : `${IST_DAY_TIME.format(new Date(iso))} IST`;
}

/**
 * Overnight TEST 12 Nov 2026: a Date whose LOCAL fields (what date-fns format/startOfWeek read) are India time,
 * so "today", the week and the card date follow India whatever the device's time zone is. India has no DST.
 */
export function istWall(d: Date = new Date()): Date {
  return new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60_000);
}

const IST_YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
/** P6 company (12 Nov 2026): a due date on an India day before today (a Lot due 10 Nov is missed on 12 Nov). */
export function pastDueIST(due: string | number | Date | null | undefined, now: Date = new Date()): boolean {
  return due != null && due !== "" && IST_YMD.format(new Date(due)) < IST_YMD.format(now);
}

/** N2 (13 Nov 2026): the India calendar day of an instant, "YYYY-MM-DD". Never `toISOString().slice(0, 10)` (that is the UTC day). */
export function istYmd(d: string | number | Date = new Date()): string {
  return IST_YMD.format(new Date(d));
}

/**
 * N2: a picked due day -> 11:59:59 PM India time that day (the same deadline a daily Lot has), as an ISO string.
 * A Date (from a calendar picker) gives its LOCAL day, the one the user clicked; a string is "YYYY-MM-DD".
 */
export function istDayEnd(day: string | Date): string {
  const ymd = typeof day === "string" ? day.slice(0, 10)
    : `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return new Date(`${ymd}T23:59:59+05:30`).toISOString();
}

