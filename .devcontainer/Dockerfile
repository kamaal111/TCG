FROM ghcr.io/jdx/mise:2026.10.6 AS mise

FROM mcr.microsoft.com/devcontainers/base:trixie

COPY --from=mise /usr/local/bin/mise /usr/local/bin/mise

ENV DEBIAN_FRONTEND=noninteractive \
    MISE_EXPERIMENTAL=1 \
    PATH="/root/.local/share/mise/shims:/root/.local/bin:${PATH}"

RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends \
        libncurses6 libpython3.13 zsh-autosuggestions zsh-syntax-highlighting \
    && rm -rf /var/lib/apt/lists/* \
    && printf '%s\n' \
        'source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh' \
        'source /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh' \
        >> /etc/zsh/zshrc

WORKDIR /opt/tcg-toolchain
COPY mise.toml .node-version ./

RUN mise install \
    && node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')" \
    && test "$node_major" = "$(cat .node-version)"

RUN mkdir -p /root/.config/mise \
    && cp mise.toml /root/.config/mise/config.toml

WORKDIR /
