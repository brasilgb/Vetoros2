import { defineConfig } from 'vitest/config';

// Só existe para tirar `e2e/**` (Playwright, seção 16 do correio.md UX-03) do escopo do
// `vitest run` — sem isso o vitest tentaria rodar os `*.spec.ts` do Playwright como testes
// unitários (mesmo padrão de nome, runner diferente) e falharia.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/.next/**'],
  },
});
