# Codex plan approval backend fix

- [x] Add focused regression test for active-chat YOLO approval backend.
- [x] Pass active backend through persisted and streaming Build/YOLO approval sends.
- [x] Run targeted tests and frontend gates; `check:all` reaches Rust then stops because local Cargo is unavailable (covered by Docker build).
- [x] Build `jean:dev` and smoke-test the built UI with agent-browser at 1440×1000.
- [x] Review diff, commit, push, and create/update PR.

## Review

- Regression test failed before the fix because the YOLO payload omitted `backend`, then passed with `backend: codex`.
- Active-chat persisted and streaming Build/YOLO paths now pass the backend captured with the approved session.
- Fresh review caught and fixed an async ref race; the regression now switches the active backend while persistence is pending.
- Typecheck, lint, targeted tests, and all 2,877 frontend tests pass (full suite used a 10s timeout after two unrelated tests exceeded 5s under load; both also passed in isolation).
- `make docker-build` produced `jean:dev`; agent-browser confirmed the built UI renders cleanly at 1440×1000.
- `bun run check:all` cannot run local Rust commands because Cargo is unavailable; the Docker build compiled the Rust release binary successfully.

## Remove update nags
- [x] Fast-forward origin/main.
- [x] Preserve passive badges; remove automatic Jean/server/CLI/Agent Browser notifications.
- [x] Verify tests, quality gates, visual UI, and jean:dev build.
- [x] Review and publish PR #20: https://github.com/nellcorp/jean/pull/20
- [x] Remove stale Web Access bundle reload warning discovered in final notification audit.
- [x] Focused silent-update tests and desktop/server startup/reload/manual-action E2E tests.
- [x] agent-browser desktop/mobile screenshots show passive badges only; manual update feedback verified.

### Review
- 413 frontend suites, 2881 tests passed with two workers. One unrelated worktree-modal timeout under concurrent build load passed in isolation and in the controlled full run.
- Typecheck and full lint passed. check:all reached missing shell Cargo; equivalent Rust format, Clippy, and tests passed in Docker: 1339 passed, one ignored.
- Two Playwright host-channel reload/manual-update tests passed. agent-browser desktop/mobile visual checks confirmed no automatic dialogs/toasts.
- Final jean:dev image built successfully and isolated runtime returned HTTP 200.
