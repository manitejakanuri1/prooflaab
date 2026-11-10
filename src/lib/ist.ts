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
