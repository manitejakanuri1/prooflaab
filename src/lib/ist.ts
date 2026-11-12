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
