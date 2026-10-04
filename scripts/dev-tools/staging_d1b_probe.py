"""STAGING ONLY. D1b exposure probe: can an anonymous caller or a student reach the body of the
SQL-internal functions through the API? Uses only a random, non-existent id as input (no row matches,
so nothing can change); functions without arguments that would change data are NOT called.

    python scripts/dev-tools/staging_d1b_probe.py [before|after]

"reached" = the function body ran (2xx, or an error raised from inside the function).
"refused" = 401/403 permission denied (42501) or PGRST202 (no function for this role).
"""
import json, os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

R = str(uuid.uuid4())
CALLS = {   # name -> args (non-existent ids only)
    "advance_season": {"_season_id": R}, "backfill_rounds": {"_season_id": R}, "claim_lot_template": {"_source_content_id": R},
    "close_season": {"_season_id": R}, "create_lot_for": {"_student_id": R, "_for_date": "2000-01-01"}, "ensure_season": {"_college_id": R},
    "extend_fixtures": {"_season_id": R}, "generate_championship": {"_season_id": R}, "generate_final": {"_season_id": R},
    "generate_knockout": {"_season_id": R}, "generate_cohort_league": {"_season_id": R, "_force": False}, "has_role": {"_user_id": R, "_role": "admin"}, "lot_needs_writer": {"_task_id": R},
    "next_lot_source": {"_student_id": R}, "plan_student_week": {"_student_id": R, "_week_start": "2000-01-03"},
    "qualify_squads": {"_season_id": R}, "recount_season": {"_season_id": R}, "run_squad_week": {"_season_id": R, "_week": 1},
    "score_student_week": {"_student_id": R, "_season_id": R, "_week": 1}, "seed_championship": {"_season_id": R},
    "seed_lot_template": {"_source_content_id": R}, "settle_round": {"_season_id": R, "_round": 1},
    "suggest_tracks": {"_student_id": R, "_limit": 1}, "refresh_unlock": {"_student_id": R, "_track": "zz-none"},
    "record_activity": {"_student_id": R, "_metric": "zz-probe"},
}
student = {"Authorization": f"Bearer {st.token('user:10ad0000-0000-4000-8000-000000014606')}"}
out = []
for name, args in CALLS.items():
    row = [name]
    for who, h in (("anon", {}), ("student", student)):
        c, b = st.http(f"{st.API}/rpc/{name}", args, h, "POST")
        code = b.get("code") if isinstance(b, dict) else None
        if c in (401, 403) and code == "42501" or code == "PGRST202":
            row.append("refused")
        else:
            row.append(f"REACHED ({c}{' ' + str(code) if code else ''})")
    out.append(row)
    print(f"{name:24} anon={row[1]:28} student={row[2]}", flush=True)
reached = sum(1 for r in out for x in r[1:] if x.startswith("REACHED"))
print(f"\n{reached} of {2 * len(out)} calls reached the function body")
json.dump(out, open(os.path.join(os.path.dirname(__file__), "..", "..", "e2e-out", f"d1b-probe-{sys.argv[1] if len(sys.argv) > 1 else 'run'}.json"), "w"), indent=1)
