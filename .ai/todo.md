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
