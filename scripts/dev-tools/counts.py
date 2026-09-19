import sys, json
from pl import token, http, API
h={"Authorization":f"Bearer {token('svc')}"}
for t in sys.argv[1:]:
    st,out=http(f"{API}/{t}", headers=h, method="GET")
    print(t, st, len(out) if isinstance(out,list) else out)
