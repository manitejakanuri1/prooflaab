// Admin times are always shown in India time with an "IST" label, whatever the viewer's computer clock is set to.
const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
const IST_SECONDS = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/** "10 Nov, 18:03 IST" */
export function fmtIST(iso: string | number | Date, seconds = false): string {
  return `${(seconds ? IST_SECONDS : IST).format(new Date(iso))} IST`;
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
