import { test, expect, login } from './fixtures';

// Seção 15.1 do correio.md UX-03.
test.describe('login e shell', () => {
  test('autentica, chega em /app com sidebar e header visíveis, e navega entre módulos', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/app$/);

    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
    // getByRole('banner') pega só o <header> de topo da aplicação — o PageHeader de cada
    // página também usa a tag <header>, mas por estar dentro de <main> não carrega esse papel.
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();

    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Clientes' }).click();
    await expect(page).toHaveURL(/\/app\/customers$/);
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();

    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Fornecedores' }).click();
    await expect(page).toHaveURL(/\/app\/suppliers$/);
    await expect(page.getByRole('heading', { name: 'Fornecedores' })).toBeVisible();
  });
});
