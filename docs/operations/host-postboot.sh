#!/bin/bash
set -euo pipefail
base=/var/lib/jean-host-maintenance
[ -f "$base/reboot-requested" ] || exit 0
{
date -u
uname -r
df -h /
systemctl is-active docker
[ ! -f /var/run/reboot-required ] || echo REBOOT_STILL_REQUIRED
docker ps --format '{{.Names}} {{.Status}}'
docker inspect dev-personal-1 dev-squire-1 --format '{{.Name}} Init={{.HostConfig.Init}} Status={{.State.Status}}'
ps -eo stat= | awk '$1 ~ /^Z/{n++} END{print "Zombies:", n+0}'
dpkg --audit
python3 - <<'PYTHON'
import subprocess
base='/var/lib/jean-host-maintenance/'
expected=set(x.strip().lstrip('/') for x in open(base+'expected-persistent.txt') if x.strip())
running=set(subprocess.check_output(['docker','ps','--format','{{.Names}}'],text=True).splitlines())
missing=sorted(expected-running)
print('Missing persistent containers:',missing)
if missing: raise SystemExit(1)
PYTHON
} > "$base/postboot-report.txt" 2>&1
cat "$base/postboot-report.txt"
date -u > "$base/postboot-checked"
