# Host maintenance — 2026-10-04

Host timer: `jean-host-maintenance.timer`, scheduled for 02:00 UTC (04:00 CEST).
Cleanup removes unreferenced volumes and stopped containers, prunes container-unused
images older than seven days, and prunes build cache unused for 24 hours. Recent
images are retained because other development sessions are building concurrently.

Persistent Jean Compose services have `init: true`. They are recreated at the
maintenance window using the image IDs saved before maintenance, not mutable tags.

Installed scripts are root-owned under `/usr/local/sbin/`. These copies are an
audit record, not a general-purpose installer. State and package logs live in
`/var/lib/jean-host-maintenance/` on the host. The Compose backup contains secrets;
keep that directory restricted and do not commit or print its contents.

## Verify

```sh
systemctl list-timers jean-host-maintenance.timer
journalctl -u jean-host-maintenance.service
journalctl -u jean-host-postboot.service
cat /var/lib/jean-host-maintenance/postboot-report.txt
docker inspect dev-personal-1 dev-squire-1 --format '{{.Name}} Init={{.HostConfig.Init}}'
df -h /
```

The reboot marker prevents repeated maintenance reboots. Postboot verification
runs after Docker starts and records results; inspect the report for failures.
Containers without restart policies may remain stopped after the reboot.

Timer semantics: https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml
Docker volume cleanup: https://docs.docker.com/engine/storage/volumes/
