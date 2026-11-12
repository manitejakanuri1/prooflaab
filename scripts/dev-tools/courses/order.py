"""Easy-to-hard order for the courses that follow their docs' folder order (owner 12 Nov 2026: docker,
kubernetes, react). Hand-made rules on chapter titles, no AI: each chapter goes to the first group whose
pattern matches its title; groups run easy to hard; inside a group the manifest order stays. Writes
<course>/order.json (list of mdFile) in the course folder. Usage: python -I order.py <ProofLab_Courses_CLEAN>"""
import json
import re
import sys
from pathlib import Path

GROUPS = {
    "docker": [
        r"^Install Docker Engine", r"post-installation", r"Start containers automatically", r"Docker object labels",
        r"Prune unused", r"^Volumes$", r"^Bind mounts$", r"^tmpfs mounts$", r"^Image mounts$", r"Port publishing",
        r"Bridge network", r"Host network", r"Compose Quickstart", r"Use docker logs|JSON File logging|Local file logging|Configure logging drivers",
        r"Resource constraints", r"Runtime metrics", r"multiple processes", r"Docker contexts", r"proxy server",
        r"CA certificates", r"daemon|Live restore", r"(?i)logging driver", r"Compose", r"storage driver|containerd image store",
        r"Overlay network|IPvlan|iptables|nftables|IPv6|Packet filtering|Legacy container links",
        r"AppArmor|Seccomp|user namespace|content trust|certificates|security|^Tips$|^Troubleshooting$",
        r"Swarm mode key concepts|Run Docker Engine in swarm mode", r"[Ss]warm|rolling updates|nodes work|services work|Configs|PKI|task states|secrets|raft|routing mesh|overlay",
        r"Prometheus|OpenTelemetry|containerd|runtime|Format command", r"release notes",
    ],
    "kubernetes": [
        r"Kubernetes Components", r"Kubernetes API", r"kubectl", r"Object Names|Namespaces|Labels and Selectors|Annotations|Field Selectors|Recommended Labels|Object Management",
        r"^Nodes$", r"^Controllers$", r"Deployments", r"ReplicaSet$", r"StatefulSets", r"DaemonSet", r"^Jobs$", r"CronJob",
        r"Finished Jobs|Managing Workloads", r"Self-Healing", r"Autoscaling", r"Init Containers|Ephemeral|Downward|Disruptions|Advanced Pod",
        r".",
    ],
    "react": [
        r"^Quick Start$", r"^Introduction$", r"^Installation$|^Creating a React App$|^Editor Setup$", r"Tic-Tac-Toe", r"Thinking in React",
        r"^Describing the UI$", r"Your First Component", r"Importing and Exporting", r"Writing Markup with JSX", r"JavaScript in JSX",
        r"Passing Props", r"Conditional Rendering", r"Keeping Components Pure", r"UI as a Tree",
        r"^Adding Interactivity$", r"Responding to Events", r"Component's Memory", r"Render and Commit", r"State as a Snapshot",
        r"Queueing", r"Updating Objects", r"Updating Arrays", r"^Managing State$", r"Reacting to Input", r"Choosing the State",
        r"Sharing State", r"Preserving and Resetting", r"Reducer$", r"Passing Data Deeply", r"Scaling Up",
        r"^Escape Hatches$", r"Referencing Values with Refs", r"Manipulating the DOM", r"Synchronizing with Effects",
        r"Might Not Need an Effect", r"Lifecycle of Reactive", r"Separating Events", r"Removing Effect", r"Custom Hooks",
        r"TypeScript|Debugging|Existing Project|from Scratch|Incremental",
        r"^Built-in React Hooks$|^React Reference Overview$", r"^useState$|^useEffect$|^useContext$|^useRef$|^useReducer$",
        r"^useMemo$|^useCallback$|^useId$|^useTransition$|^useDeferredValue$", r"^use[A-Z]|^use$",
        r"Rules of|must be pure|calls Components", r"^<|^Common components|^React DOM", r".",
    ],
}


def order(titles: list[str], groups: list[str]) -> list[int]:
    """Indexes of `titles` in easy-to-hard order (first matching group; manifest order inside a group)."""
    rank = [next((g for g, p in enumerate(groups) if re.search(p, t)), len(groups)) for t in titles]
    return sorted(range(len(titles)), key=lambda i: (rank[i], i))


def main(root: Path) -> None:
    for course, groups in GROUPS.items():
        m = json.loads((root / course / "manifest.json").read_text(encoding="utf-8"))
        idx = order([c["title"] for c in m], groups)
        (root / course / "order.json").write_text(json.dumps([m[i]["mdFile"] for i in idx], indent=1), encoding="utf-8")
        print(course, "->", " | ".join(m[i]["title"] for i in idx[:12]), "...", m[idx[-1]]["title"])


if __name__ == "__main__":
    assert order(["Docker Engine 17.03 release notes", "Volumes", "Install Docker Engine from binaries"], GROUPS["docker"]) == [2, 1, 0]
    main(Path(sys.argv[1]))
