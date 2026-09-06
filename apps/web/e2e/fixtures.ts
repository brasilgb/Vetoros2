import { test as base, expect, type Page } from '@playwright/test';

// Credenciais do usuário de desenvolvimento seedado por `packages/db/src/seed.ts`
// (`dev_faker_all`, todas as permissões no tenant de teste) — sobrescrevíveis por variável de
// ambiente para não prender a suíte a um valor fixo.
export const E2E_EMAIL = process.env.E2E_EMAIL ?? 'andersonbrasil72@gmail.com';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? '12345678';

// Empresa/filial seedadas — estáveis entre execuções (o seed usa `on conflict do nothing`/`do
// update`, então o nome não muda de uma rodada para outra).
export const SEED_COMPANY = 'Company Alpha';
export const SEED_BRANCH = 'Branch Alpha';
export const SEED_CUSTOMER = 'Cliente Alpha PF';

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(E2E_EMAIL);
  await page.getByLabel('Senha').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/(app|select-tenant)/, { timeout: 15_000 });
}

/** Seleciona Empresa/Filial pelos seletores do cabeçalho (desktop). */
export async function selectContextFromHeader(page: Page) {
  await page.locator('header select[aria-label="Empresa ativa (cabeçalho)"]').selectOption({ label: SEED_COMPANY });
  await page.locator('header select[aria-label="Filial ativa (cabeçalho)"]').selectOption({ label: SEED_BRANCH });
  await expect(page.locator('header select[aria-label="Filial ativa (cabeçalho)"]')).toHaveValue(/.+/);
}

export const test = base;
export { expect };
