import json, sys
from pl import token, http, API
h={"Authorization":f"Bearer {token('svc')}"}
D=sys.argv[1]
st,studs=http(f"{API}/student_profiles?select=*",headers=h,method="GET")
ids=[s["id"] for s in studs]
inn="("+",".join(ids)+")"
out={"student_profiles":studs}
for t,col in [("student_contact","student_id"),("user_roles","user_id"),("tasks","student_id"),("student_tracks","student_id"),
              ("student_levels","student_id"),("resume_scorecards","student_id"),("student_streaks","student_id"),
              ("voice_explanations","student_id"),("student_activity_events","student_id"),("account_identities","user_id"),
              ("student_skills","student_id"),("resume_claims","student_id"),("student_imports",None),("student_import_rows",None)]:
    q=f"{API}/{t}?select=*"+(f"&{col}=in.{inn}" if col else "")
    st,rows=http(q,headers=h,method="GET"); out[t]=rows if st==200 else f"ERR {st} {rows}"
    print(t, st, len(rows) if isinstance(rows,list) else rows)
json.dump(out,open(f"{D}/students.json","w"),indent=1,default=str)
open(f"{D}/ids.txt","w").write("\n".join(ids))
open(f"{D}/emails.txt","w").write("\n".join(c["email"] for c in out["student_contact"] if isinstance(out["student_contact"],list) and c.get("email")))
