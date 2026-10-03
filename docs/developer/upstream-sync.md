# Verifying an upstream sync

Merge a published upstream tag into a branch based on the fork's `main`. Keep the
release's manifests and lockfiles together. Review both conflict resolutions and
files changed by both repositories; a clean textual merge does not establish
compatibility.

## Fork compatibility checks

- Claude output styles must survive session persistence and merge with custom
  profiles through a single private settings file. Fragmented blocking-tool input
  must be complete before Jean stops the Claude process.
- Linear project filtering, labels, issue relations, and Outline commands must
  remain available through the core dispatcher and Jean MCP.
- Integration and managed skill/style operations must target the owning project
  or selected Settings server. Remote caches must not share local keys. Redacted
  integration tokens use configured flags for availability and removal controls.
- Browser editor actions must remain available when `web_editor_url` is set.
  Native-capable Web Access without that setting must still invoke its native
  editor. Both desktop and mobile style lists must include project-local styles.
- Preserve the fork's Docker toolchain, explicit tokenless wildcard-bind override,
  and container-specific Codex sandbox configuration.

The Docker CLI pins are build-time versions. Automatic backend updates can update
System PATH installations as well as Jean-managed installations. Disable that
preference when verifying the pinned binaries, and record the actual version used.

## Verification

Run `bun run check:all` with Rust available, then `make docker-build`. In the
agent environment Rust checks run inside a builder container. Test the built
`jean:dev` image in an isolated Docker Compose project and temporary app-data
volume, not against a running user's volume.

Run the read-only backend smoke check from the repository root:

```sh
JEAN_SMOKE_URL="http://<container-bridge-ip>:3456" \
  bun scripts/verify-fork-upgrade.mjs
```

For authenticated servers, supply `JEAN_SMOKE_TOKEN` privately. To also verify
Linear and Outline reads, set `JEAN_SMOKE_PROJECT_ID` to an isolated test project's
raw Jean id with both integrations configured. The script does not print tokens
or response bodies.

Inspect the actual app with agent-browser at desktop and mobile widths. Verify
chat, project settings, skills, output styles, menus, terminal tabs, and the browser
editor. Check profile/style execution, a blocking tool, and restart recovery.

In DinD, containers are host siblings. Use the target's bridge IP for shell
requests; verify published URLs through a host-network helper. Never use the
agent's localhost to reach a host-published port.
