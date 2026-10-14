"""The Hosting rewrite list used by scripts/deploy-hosting.py. No network, nothing is changed.

Kept in its own file so the one rule that matters can be tested: /api/** must go to the gateway
BEFORE the catch-all that serves the app's page. Firebase Hosting uses the first matching rewrite,
so the other order answers every /api call with index.html and nobody can sign in.
"""


def rewrites(bff_service: str, bff_region: str) -> list:
    found = []
    if bff_service:
        found.append({"glob": "/api/**", "run": {"serviceId": bff_service, "region": bff_region}})
    # Keep the SPA catch-all last. Firebase Hosting uses the first matching rewrite.
    found.append({"glob": "**", "path": "/index.html"})
    return found
