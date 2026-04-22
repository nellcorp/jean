# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Stage 1 — frontend build (Vite/React via Bun)
# ---------------------------------------------------------------------------
FROM oven/bun:1.2-debian AS frontend-builder

WORKDIR /app

# Install frontend deps first so Docker caches this layer on source-only changes.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the rest of the sources needed for `bun run build` (tsc + vite).
COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
# scripts/ is referenced from package.json (e.g. postbuild), keep it available.
COPY scripts ./scripts

# `bun run build` runs `tsc && vite build` and outputs to ./dist.
RUN bun run build

# ---------------------------------------------------------------------------
# Stage 2 — Rust build of the `jean` binary (headless-capable)
# ---------------------------------------------------------------------------
# Use the Debian-based Rust image so the same libwebkit2gtk/GTK dev libs that
# Tauri links against are available, and so glibc matches the runtime stage.
FROM rust:1.89-bookworm AS rust-builder

# System deps required by tauri-build + the Rust crates we depend on.
# Mirrors what the upstream release workflow installs on ubuntu-22.04.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    libjavascriptcoregtk-4.1-dev \
    libsoup-3.0-dev \
    libgtk-3-dev \
    libappindicator3-dev \
    librsvg2-dev \
    libglib2.0-dev \
    ca-certificates \
    curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the Cargo manifests + sources. tauri-build reads tauri.conf.json at
# compile time, so we need the whole src-tauri tree plus tauri.conf.json.
COPY src-tauri ./src-tauri

# tauri-build validates `frontendDist` (../dist) exists, so we have to place
# the frontend artifacts from stage 1 where tauri.conf.json expects them.
COPY --from=frontend-builder /app/dist ./dist

WORKDIR /app/src-tauri

# Build just the `jean` binary (skip tests, examples, the cdylib, etc.).
# The release profile in Cargo.toml enables LTO + strip, so the output is
# already a slim, stripped executable.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/src-tauri/target \
    cargo build --release --bin jean \
 && mkdir -p /out \
 && cp target/release/jean /out/jean

# ---------------------------------------------------------------------------
# Stage 3 — runtime image
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

ARG NODE_VERSION=22

# Runtime dependencies:
#   - libwebkit2gtk / libgtk / libappindicator / libglib: required by the jean
#     binary even in headless mode (WebKit initializes GTK at startup).
#   - xvfb: virtual framebuffer so WebKit/GTK can init without a real display.
#   - git, openssh-client, tmux: used by jean + Claude Code at runtime for
#     worktrees/sessions (ssh is needed to clone/pull over git+ssh URLs).
#   - curl, ca-certificates, gnupg: needed to install Node.js + for git HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    git \
    openssh-client \
    lsof \
    tmux \
    xvfb \
    libwebkit2gtk-4.1-0 \
    libjavascriptcoregtk-4.1-0 \
    libsoup-3.0-0 \
    libgtk-3-0 \
    libappindicator3-1 \
    libglib2.0-0 \
    librsvg2-2 \
 && rm -rf /var/lib/apt/lists/*

# Pre-populate the system-wide known_hosts with public git hosts so ssh
# doesn't prompt (and doesn't try to fall back to ssh-askpass) when the
# user's ~/.ssh is mounted read-only. Users can still override behaviour
# via ~/.ssh/config if they need to.
RUN mkdir -p /etc/ssh \
 && ssh-keyscan -t rsa,ecdsa,ed25519 github.com gitlab.com bitbucket.org codeberg.org ssh.dev.azure.com \
        > /etc/ssh/ssh_known_hosts 2>/dev/null \
 && chmod 0644 /etc/ssh/ssh_known_hosts

# Install Node.js (for Claude Code).
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Install the Docker CLI (just the client, not the engine) so the
# container can talk to the host's Docker daemon via a bind-mounted
# /var/run/docker.sock. Comes from Docker's official Debian apt repo.
RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg \
        -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*


# Install Claude Code globally.
RUN npm install -g @anthropic-ai/claude-code \
 && npm cache clean --force

# Lay out the application under /opt/jean. The http_server's
# resolve_dist_path() looks for a `dist/` directory next to the jean
# executable as one of its fallbacks, which matches this layout exactly.
WORKDIR /opt/jean
COPY --from=rust-builder /out/jean /opt/jean/jean
COPY --from=frontend-builder /app/dist /opt/jean/dist
RUN chmod +x /opt/jean/jean \
 && ln -s /opt/jean/jean /usr/local/bin/jean

# Default mount points used by docker-compose setups.
RUN mkdir -p /projects /worktrees

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV HOME=/root \
    DISPLAY_NUM=99 \
    JEAN_HOST=0.0.0.0 \
    JEAN_PORT=3456
WORKDIR /root

EXPOSE 3456

ENTRYPOINT ["/entrypoint.sh"]
