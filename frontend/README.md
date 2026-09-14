# PulseDesk frontend

The frontend is an Angular 22 standalone application. Development runs in the
repository's Docker Compose stack; a host Node installation is not required.

## Development

From the repository root, provide the existing backend environment variables
(including `JWT_SECRET`) and run:

```sh
docker compose build frontend
docker compose up -d
```

The application is available at <http://localhost:4200> and calls the backend
directly at <http://localhost:8000/api/v1>. The bind mount plus the dedicated
`frontend_node_modules` volume keeps live reload working without overlaying
container dependencies with host dependencies.

## OpenAPI client

Generated files under `src/app/api/generated/` are transport code and must not
be edited manually. The committed `openapi/openapi.json` is exported
deterministically from FastAPI, and OpenAPI Generator is pinned by
`openapitools.json`.

From `frontend/`, refresh both the contract and client with:

```sh
npm run openapi:refresh
```

The export uses Docker, so it does not require host Python dependencies. The
generation command formats the generated TypeScript with the project's pinned
Prettier before replacing the existing client, so its output is commit-ready.
The Angular application wraps generated services at feature/platform boundaries
where presentation-facing behavior or runtime date parsing is needed.

## Quality commands

```sh
npm run build
npm run lint
npm run test:ci
npm run format:check
```
