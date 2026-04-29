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
    wget \
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

# Install Tailscale so the container can optionally join a tailnet at
# startup via TS_AUTHKEY. Entrypoint runs `tailscaled` with
# `--tun=userspace-networking`, so no /dev/net/tun or CAP_NET_ADMIN is
# required at runtime.
RUN install -m 0755 -d /usr/share/keyrings \
 && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
        -o /usr/share/keyrings/tailscale-archive-keyring.gpg \
 && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
        -o /etc/apt/sources.list.d/tailscale.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends tailscale \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/bin/tailscale /usr/local/bin/ts


# Install Claude Code + Yarn globally.
RUN npm install -g @anthropic-ai/claude-code yarn \
 && npm cache clean --force

# Install Playwright globally and its browser binaries + system deps.
# `playwright install --with-deps` fetches Chromium, Firefox, and WebKit
# plus every shared library they need on Debian bookworm.
RUN npx playwright install --with-deps

# ---------------------------------------------------------------------------
# Language runtimes & LSP servers
# ---------------------------------------------------------------------------
# Provide full LSP support for the pre-installed VS Code extensions.
# Sorted roughly by image-size impact (smallest first) so the heaviest
# layers change only when their specific ARGs are bumped.

# --- Apt-installable tools ---
# shellcheck  → timonwong.shellcheck extension
# protobuf-compiler + clang-format → zxh404.vscode-proto3 extension
# python3 + pip + venv → ms-python.python extension
# make → ms-vscode.makefile-tools extension
# unzip → needed to extract terraform-ls zip
# vim → terminal editor for interactive container use
RUN apt-get update && apt-get install -y --no-install-recommends \
    make \
    shellcheck \
    protobuf-compiler \
    clang-format \
    python3 \
    python3-pip \
    python3-venv \
    unzip \
    vim \
 && rm -rf /var/lib/apt/lists/*

# --- Developer toolbox ---
# Compilers + build helpers, network/diagnostic tools, file/text utilities,
# DB clients, archive formats, and shell ergonomics. Mirrors what a typical
# Linux dev workstation has so the container is usable for general-purpose
# work, not just running the Jean binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    clang \
    cmake \
    pkg-config \
    autoconf \
    automake \
    libtool \
    net-tools \
    iputils-ping \
    iputils-tracepath \
    traceroute \
    dnsutils \
    iproute2 \
    netcat-openbsd \
    telnet \
    mtr-tiny \
    tcpdump \
    htop \
    strace \
    ltrace \
    jq \
    nano \
    less \
    file \
    tree \
    zip \
    bzip2 \
    xz-utils \
    ripgrep \
    fd-find \
    rsync \
    postgresql-client \
    default-mysql-client \
    sqlite3 \
    redis-tools \
    screen \
    bash-completion \
    man-db \
    locales \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sf /usr/bin/fdfind /usr/local/bin/fd

# --- Python tooling (ms-python.python extension) ---
# ruff: linter + formatter, pyright: type-checker / LSP, uv: fast package manager
RUN pip install --break-system-packages ruff pyright uv

# --- Hadolint (exiasr.hadolint extension) ---
ARG HADOLINT_VERSION=2.14.0
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) hl_arch=x86_64 ;; \
      arm64) hl_arch=arm64 ;; \
      *) echo "hadolint: unsupported arch $arch, skipping" >&2; exit 0 ;; \
    esac; \
    curl -fsSL "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-Linux-${hl_arch}" \
      -o /usr/local/bin/hadolint \
 && chmod +x /usr/local/bin/hadolint

# --- Helm (Tim-Koehler.helm-intellisense extension) ---
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash



# --- Go + gopls (golang.go extension) ---
ARG GO_VERSION=1.26.2
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz" \
      | tar -xz -C /usr/local
ENV GOPATH=/root/go
ENV PATH="/usr/local/go/bin:${GOPATH}/bin:${PATH}"
RUN go install golang.org/x/tools/gopls@latest

# Login shells (e.g. the terminal spawned by openvscode-server) source
# /etc/profile, which on Debian hardcodes PATH and drops the ENV-set
# additions above. Drop a /etc/profile.d file so login shells keep Go's
# bin dirs (and any other future tool dirs) on PATH.
RUN printf '%s\n' \
    'export GOPATH="${GOPATH:-/root/go}"' \
    'export PATH="/usr/local/go/bin:${GOPATH}/bin:${PATH}"' \
    > /etc/profile.d/jean-paths.sh \
 && chmod 0644 /etc/profile.d/jean-paths.sh

# --- HashiCorp terraform-ls (hashicorp.terraform extension) ---
ARG TERRAFORM_LS_VERSION=0.38.6
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    curl -fsSL "https://releases.hashicorp.com/terraform-ls/${TERRAFORM_LS_VERSION}/terraform-ls_${TERRAFORM_LS_VERSION}_linux_${arch}.zip" \
      -o /tmp/tls.zip \
 && unzip /tmp/tls.zip -d /usr/local/bin \
 && rm -f /tmp/tls.zip \
 && chmod +x /usr/local/bin/terraform-ls

# --- Atlas (ariga.io) — DB schema migration CLI ---
ARG ATLAS_VERSION=v0.38.0
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64|arm64) ;; \
      *) echo "atlas: unsupported arch $arch, skipping" >&2; exit 0 ;; \
    esac; \
    curl -fsSL "https://release.ariga.io/atlas/atlas-linux-${arch}-${ATLAS_VERSION}" \
      -o /usr/local/bin/atlas \
 && chmod +x /usr/local/bin/atlas

# --- Stripe CLI ---
ARG STRIPE_CLI_VERSION=1.31.0
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) stripe_arch=linux_x86_64 ;; \
      arm64) stripe_arch=linux_arm64 ;; \
      *) echo "stripe-cli: unsupported arch $arch, skipping" >&2; exit 0 ;; \
    esac; \
    curl -fsSL "https://github.com/stripe/stripe-cli/releases/download/v${STRIPE_CLI_VERSION}/stripe_${STRIPE_CLI_VERSION}_${stripe_arch}.tar.gz" \
      -o /tmp/stripe.tgz; \
    tar -xzf /tmp/stripe.tgz -C /usr/local/bin stripe; \
    rm -f /tmp/stripe.tgz; \
    chmod +x /usr/local/bin/stripe



# ---------------------------------------------------------------------------
# Web editor: openvscode-server (Gitpod's build of VS Code web)
# ---------------------------------------------------------------------------
# We install it into the same container so the web UI can launch a full
# editor scoped to any worktree via /code?folder=<abs-path>. Listens only
# on 127.0.0.1:3457 — exposing it is the reverse proxy's job.
ARG OPENVSCODE_SERVER_VERSION=1.109.5
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) ovs_arch=x64 ;; \
      arm64) ovs_arch=arm64 ;; \
      armhf) ovs_arch=armhf ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    mkdir -p /opt/openvscode-server; \
    curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_SERVER_VERSION}/openvscode-server-v${OPENVSCODE_SERVER_VERSION}-linux-${ovs_arch}.tar.gz" \
      | tar -xz --strip-components=1 -C /opt/openvscode-server; \
    ln -s /opt/openvscode-server/bin/openvscode-server /usr/local/bin/openvscode-server

# Pre-install language/tooling extensions from Open VSX so first-open of
# any project has syntax highlighting + LSP ready to go. Anything that
# fails to install (temporary Open VSX outage, a single extension being
# unavailable, etc.) is logged but does not fail the build.
RUN set -eux; \
    for ext in \
        ms-python.python \
        golang.go \
        svelte.svelte-vscode \
        ms-azuretools.vscode-docker \
        exiasr.hadolint \
        hashicorp.terraform \
        Prisma.prisma \
        zxh404.vscode-proto3 \
        Tim-Koehler.helm-intellisense \
        bierner.markdown-mermaid \
        timonwong.shellcheck \
        ms-vscode.makefile-tools \
        matthewpi.caddyfile-support \
        mtxr.sqltools \
    ; do \
      /opt/openvscode-server/bin/openvscode-server --install-extension "$ext" \
        || echo "WARN: failed to preinstall $ext, continuing"; \
    done


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
    JEAN_PORT=3456 \
    CODE_HOST=0.0.0.0 \
    CODE_PORT=3457 \
    CODE_BASE_PATH=/code
WORKDIR /root

# 3456 = Jean HTTP/WS server, 3457 = openvscode-server (proxy as /code).
EXPOSE 3456 3457

ENTRYPOINT ["/entrypoint.sh"]
