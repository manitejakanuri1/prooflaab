"""python fn.py <who> <function> '<json body>'"""
import sys, json
from pl import token, http
F="https://prooflab-functions-135298577404.asia-south1.run.app"
who, fn = sys.argv[1:3]; body=json.loads(sys.argv[3]) if len(sys.argv)>3 else {}
st,out=http(f"{F}/{fn}", body, {"Authorization":f"Bearer {token(who)}"}, "POST")
print(st, json.dumps(out, indent=1, default=str)[:5000])
