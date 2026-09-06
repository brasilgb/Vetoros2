import { defineConfig, devices } from '@playwright/test';

// Suíte E2E mínima e permanente (seção 15/16 do correio.md UX-03) — não tenta subir a
// aplicação sozinha: precisa da API e do Postgres de verdade rodando (é o mesmo requisito da
// validação visual do UX-01/UX-02), então não declara `webServer`. Ver `e2e/README.md`.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // os specs compartilham o mesmo tenant seedado (mesmo usuário, mesmo contexto operacional)
  workers: 1, // um único servidor de dev + um único Postgres local: rodar em paralelo só disputa recurso e gera flakiness sem necessidade nesta suíte pequena
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
