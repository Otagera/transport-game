# The game as Coolify serves it: built with Bun, served as static files by nginx.
# Coolify passes SOURCE_COMMIT, which vite.config.ts stamps into run files (.git
# isn't in the build context).
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT
RUN bun run build && bun scripts/verify-prod-bundle.mjs

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
