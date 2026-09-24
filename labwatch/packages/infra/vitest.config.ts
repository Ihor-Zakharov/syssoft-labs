import { defineConfig } from 'vitest/config';

// The SQL test files both run the migrations against the same (possibly empty) database in beforeAll;
// running them one after another avoids two migrators racing on CREATE SCHEMA.
export default defineConfig({
  test: { fileParallelism: false },
});
