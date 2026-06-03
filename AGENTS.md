# Repository Guidelines

## Project Structure & Module Organization

```
├── src/                  # Application source code
│   ├── index.ts          # Cloudflare Workers entry point
│   ├── serve.ts          # Local dev server (Hono + @hono/node-server)
│   ├── types/            # Generated Supabase type definitions
│   ├── client/           # Auto-generated API client
│   └── *.ts              # Feature modules (auth, campaigns, messages, etc.)
├── test/                 # Vitest test suites (mirrors src layout)
│   ├── setup.ts          # Global test setup
│   └── *.test.ts         # Test files
├── bin/                  # CLI tool scripts (fetch, mail, reply)
├── scripts/              # Utility scripts (model preloading)
├── doc/                  # OpenAPI spec, generated docs, and API reference
├── supabase/             # Supabase migrations and Edge Functions
├── docs/                 # Additional documentation
└── .github/workflows/    # CI pipeline definitions
```

## Build, Test, and Development Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the local dev server via `tsx src/serve.ts` |
| `npm run build` | Compile TypeScript to `dist/` using `tsconfig.build.json` |
| `npm run typecheck` | Run type-checking without emitting output |
| `npm test` | Execute all tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with V8 coverage reporting |
| `npm run lint` | Lint source with Biome |
| `npm run format` | Check formatting with Biome |
| `npm run check` | Run both lint and format checks |
| `npm run check:fix` | Auto-fix all lint and formatting issues |
| `npm run wrangler:dev` | Run the Cloudflare Workers dev server locally |
| `npm run deploy` | Deploy to Cloudflare Workers (supports `--env staging\|production`) |

## Coding Style & Naming Conventions

- **Formatter**: Biome with 2-space indentation, double quotes, semicolons, trailing commas, 80-char line width.
- **Linter**: Biome recommended rules — `noUnusedVariables` is an error, `noExplicitAny` is a warning.
- **Naming**: Use `camelCase` for variables, functions, and file names. Use `PascalCase` for types and classes.
- **Imports**: Biome organizes imports automatically on save (`organizeImports: "on"`).
- Apply formatting with `npm run format:fix` and linting with `npm run lint:fix` before committing.

## Testing Guidelines

- **Framework**: [Vitest](https://vitest.dev/) with `globals: true`.
- **Coverage**: Minimum 80% on branches, functions, lines, and statements (configured in `vitest.config.ts`).
- **Test files**: Co-located in `test/` with a `.test.ts` suffix (e.g., `analytics.test.ts`, `api_messages.test.ts`).
- **Setup**: Global test hooks live in `test/setup.ts`.
- Run `npm test` for a single pass, `npm run test:coverage` to verify thresholds, or `npm run test:watch` during development.

## Commit & Pull Request Guidelines

- **Commit messages**: Use the imperative mood and keep the first line under 72 characters. Prefix optional scopes in parentheses (e.g., `feat(cli): add --limit flag to reply`, `refactor: extract email headers`).
- **Pull requests**: Provide a clear description of the change, link related issues, and include screenshots for UI-affecting changes. Ensure all tests pass and coverage thresholds are met before requesting review.

## Security & Configuration

- Secrets (database URLs, API keys, JWTs) are stored in `.env` and `.dev.vars` — never commit them. Use the provided `.env` template as a guide.
- Environment variables are loaded via `dotenv` in development and via Cloudflare Workers bindings in production/staging.
- Sensible defaults are provided for local development; only override values you need to change.
