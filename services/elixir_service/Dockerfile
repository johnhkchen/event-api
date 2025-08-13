# Build stage
FROM hexpm/elixir:1.18.4-erlang-27.2.7.1-ubuntu-24.04 AS build

# Install build dependencies
RUN apt-get update -y && apt-get install -y \
    build-essential \
    git \
    nodejs \
    npm \
    && apt-get clean && rm -f /var/lib/apt/lists/*_*

# Set build environment
ENV MIX_ENV=prod

# Create and change to the app directory
WORKDIR /app

# Copy manifest files
COPY mix.exs mix.lock ./
RUN mix local.hex --force && \
    mix local.rebar --force

# Install dependencies
RUN mix deps.get --only prod
RUN mkdir config

# Copy configuration files
COPY config/config.exs config/prod.exs config/runtime.exs config/
RUN mix deps.compile

# Copy assets and compile them
COPY assets/package.json assets/package-lock.json ./assets/
RUN npm --prefix ./assets ci --progress=false --no-audit --loglevel=error

COPY priv priv
COPY assets assets
RUN mix assets.deploy

# Copy source code and compile application
COPY lib lib
COPY rel rel
RUN mix compile

# Build release
RUN mix release

# Runtime stage
FROM ubuntu:24.04 AS runtime

# Install runtime dependencies
RUN apt-get update -y && \
    apt-get install -y \
    libstdc++6 \
    openssl \
    libncurses6 \
    locales \
    ca-certificates \
    && apt-get clean && rm -f /var/lib/apt/lists/*_*

# Set locale
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

# Create app user
RUN useradd --system --shell /bin/bash --home /app app
USER app
WORKDIR /app

# Copy built application
COPY --from=build --chown=app:app /app/_build/prod/rel/event_api ./

# Set environment variables
ENV MIX_ENV=prod
ENV PHX_SERVER=true

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:4000/health/liveness || exit 1

# Expose port
EXPOSE 4000

# Start the application
CMD ["./bin/event_api", "start"]