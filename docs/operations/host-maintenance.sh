#!/bin/bash
set -euo pipefail
exec 9>/var/lib/jean-host-maintenance/lock
flock -n 9 || exit 0
[ ! -f /var/lib/jean-host-maintenance/reboot-requested ] || exit 0
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update --error-on=any
apt-get -y --with-new-pkgs upgrade
cd /home/ubuntu/dev
docker compose config --quiet
# Preserve the exact deployed images rather than switching to a newer mutable tag.
python3 - <<'PY'
import json
base='/var/lib/jean-host-maintenance/'
services={n:{'image':open(base+n+'-image.txt').read().strip()} for n in ['personal','squire']}
open(base+'images.json','w').write(json.dumps({'services':services}))
PY
docker compose -f docker-compose.yml -f /var/lib/jean-host-maintenance/images.json up -d --no-deps --force-recreate personal squire
date -u > /var/lib/jean-host-maintenance/reboot-requested
systemctl reboot
