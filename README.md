# Swimlane Generator

The app uses Supabase Auth and stores process diagrams in the `process_diagrams` table. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` for local development.

## Shared data types

`src/types.ts` defines the persisted `Step` and `ProcessDiagram` shapes. Step properties retain the existing JSON keys (`stepName`, `stepType`, and `predecessorId`) to stay compatible with saved diagrams.

## Validation

- `npm run typecheck` checks the strict TypeScript contracts.
- `npm run lint` runs ESLint.
- `npm run build` creates the production bundle.
- `npm run test:e2e -- --project=chromium` runs the browser tests against a local Vite server and mocked Supabase auth/database routes. The E2E suite does not require real Supabase credentials.
