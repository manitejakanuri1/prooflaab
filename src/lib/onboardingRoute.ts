/**
 * Where a signed-in, non-student account goes while its one-time setup flag
 * (user_roles.has_completed_wizard) is still false. Admins have no onboarding
 * (same rule as RoleBasedProtectedRoute and Index); a recruiter's setup is on
 * the company dashboard. Students never use this: they are gated by /student/start.
 */
export function onboardingRoute(role: string): string {
  switch (role) {
    case "admin": return "/admin/dashboard";
    case "college_admin": return "/onboarding/college";
    case "startup": return "/onboarding/startup";
    case "recruiter": return "/company/dashboard";
    default: return "/onboarding-wizard";
  }
}
