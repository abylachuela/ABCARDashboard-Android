# syntax=docker/dockerfile:1
# Contexto de build: Educentro/ (compose: context '..'). El filtro está en Dockerfile.dockerignore (lista blanca: NO entra datos-privados).
# Etapa 1: dependencias de producción (sin devDependencies)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Etapa 2: compilación (con devDependencies)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/tsconfig.json server/tsconfig.build.json ./
RUN npm ci
COPY server/src ./src
RUN npm run build

# Etapa 3: imagen final mínima, usuario no root
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server/package.json ./
COPY --chown=node:node server/migrations ./migrations
# Cálculo compartido con el cliente (calculo-shim los carga sin copiarlos al código): solo estos 6 archivos del frontend (cálculo, formato, consultas, horarios-motor y curriculo-semilla).
COPY --chown=node:node js/core/escala.js js/core/calculo.js js/core/formato.js ./js/core/
COPY --chown=node:node js/data/consultas.js js/data/curriculo-semilla.js ./js/data/
COPY --chown=node:node js/vistas/horarios-motor.js ./js/vistas/
ENV EDU_JS_DIR=/app/js
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
