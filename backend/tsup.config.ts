import { defineConfig } from 'tsup';

/**
 * The backend is transpiled with esbuild (fast, no type-checking on the build
 * critical path). Type safety is enforced separately via `npm run typecheck`
 * (tsc --noEmit) in CI / pre-commit.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate-cli.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  bundle: true,
  // Keep node_modules external; bundle our own workspace `shared`.
  noExternal: ['shared'],
  skipNodeModulesBundle: true,
  dts: false,
});
