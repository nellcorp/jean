# Host maintenance
- [x] Reclaim unused Docker volumes, stopped containers, old images and build cache
- [x] Install updates with service restart suppression; restore new container starts via containerd restart
- [x] Enable Compose init and arm 2026-10-04 02:00 UTC host maintenance timer
- [x] Install postboot verification, validate units/scripts, smoke-test idempotency guards
- [x] Finish required jean:dev build
- [x] Create audit PR #19
- [ ] Verify actual reboot/kernel/zombie cleanup after scheduled window

## Review
- Root usage: 99% initially, 60% after the required rebuild, with 167 GB available.
- Volume prune reclaimed 66.16 GB; cache prune reclaimed 11.56 GB.
- Apt update/upgrade/autoremove completed, dpkg audit clean, no pending upgrades.
- Timer verified active; Compose valid and persistent Jean services have init=true configured.
- Actual kernel switch and zombie removal intentionally pending scheduled reboot.
- New-container smoke test passed after containerd-only restart; Jean service uptime unchanged.
- Two temporary kinaxixi-eng717 application containers vanished during concurrent activity; cause unverified.

# Restore browser editor
- [x] Detect the bundled editor when its URL preference is missing.
- [x] Test discovery, missing editor, overrides, and native behavior.
- [x] Build matching deployed frontend, verify live menu and editor launch.
- [x] Build jean:dev.
- [x] Create PR: https://github.com/nellcorp/jean/pull/21

## Browser editor verification
- 40 targeted tests pass; typecheck, lint, formatting pass.
- check:all stops at Rust formatting because cargo is not installed; no Rust changes.
- Live agent-browser: Open Editor opens thorn-urchin; package.json loads; temporary file edited, saved, and verified on disk.
- Matching deployed frontend hot-installed at /opt/jean/dist without restarting Jean.
- jean:dev rebuilt from existing runtime image plus patched matching frontend; backend binary preserved.
