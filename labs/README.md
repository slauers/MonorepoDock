# Labs

Conjuntos de monorepo pequenos para validar o MonoDock.

## `pnpm-basic`

- Detectores esperados: `pnpm` + `pnpm-workspace`
- Comandos úteis:
  - `pnpm -r build`
  - `pnpm -r test`
  - `pnpm --filter @pnpm-basic/web dev` (processo contínuo)

## `nx-basic`

- Detectores esperados: `npm`/`unknown` + `nx`
- Comandos úteis:
  - `npm run build`
  - `npm run test`
  - `npm run dev` (processo contínuo)

## `turbo-basic`

- Detectores esperados: `npm`/`unknown` + `turborepo`
- Comandos úteis:
  - `npm run build`
  - `npm run test`
  - `npm run dev` (processos contínuos em paralelo)

## `go-workspace`

- Detector esperado: `go-workspace`
- Comandos úteis:
  - `go run ./services/api`
  - `go run ./services/worker`

## `docker-stack`

- Uso para testes de integração Docker no futuro:
  - `docker compose up -d`
  - `docker compose down`
