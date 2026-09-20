import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * A web page's title with the site tail cut off: "TCS Interview Experience 2026 | PrepInsta"
 * -> "TCS Interview Experience 2026". A Lot made from a page before its own title was
 * written shows the page's raw title, and the tail is just noise to a student.
 */
export function tidyTitle(title?: string | null): string {
  const t = title ?? ""
  return t.replace(/\s+\|\s+.*$/, "").trim() || t
}

/**
 * "Asha Kumar" -> "AK". Used for the fallback shown inside an avatar when
 * someone has no photo.
 *
 * This was declared privately in twelve components, each a copy of the same
 * five lines. A name that is empty or all spaces used to crash the versions
 * that read n[0]; this one returns "?" instead.
 */
export function getInitials(name?: string | null): string {
  return (
    (name ?? "")
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  )
}
