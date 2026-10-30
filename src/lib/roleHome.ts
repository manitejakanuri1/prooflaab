/** Each role's own dashboard (MF-048: a wrong-role page sends the user here, never to sign-in). */
export function roleHome(role: string | null | undefined): string {
  switch (role) {
    case "admin": return "/admin/dashboard";
    case "college_admin": return "/college/dashboard";
    case "startup":
    case "recruiter": return "/company/dashboard";
    default: return "/student/dashboard";
  }
}
