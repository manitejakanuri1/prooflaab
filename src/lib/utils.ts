import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
