import { test, expect, login, selectContextFromHeader, SEED_CUSTOMER } from './fixtures';

test.describe('VEN-01/VEN-02/VEN-03 — vendas', () => {
  test('cria, confirma, cancela e preserva o documento histórico', async ({ page }) => {
    const description = `Serviço VEN-03 ${Date.now().toString(36)}`;

    await login(page);
    await page.goto('/app');
    await selectContextFromHeader(page);
    await page.goto('/app/sales/new');

    await expect(page.getByLabel('Data da venda')).toHaveValue(/\d{4}-\d{2}-\d{2}/);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/customers?') && response.url().includes(`search=${encodeURIComponent(SEED_CUSTOMER)}`)),
      page.getByLabel('Cliente (opcional)').fill(SEED_CUSTOMER),
    ]);
    const customerOption = page.getByRole('listbox').getByText(SEED_CUSTOMER, { exact: true });
    await expect(customerOption).toBeVisible();
    await customerOption.click();
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/sales') && response.request().method() === 'POST' && response.status() === 201),
      page.getByRole('button', { name: 'Criar venda' }).click(),
    ]);
    await page.waitForURL(/\/app\/sales\/[0-9a-f-]+$/);

    await page.getByLabel('Tipo').selectOption({ label: 'Serviço' });
    await page.getByLabel('Descrição').fill(description);
    await page.getByLabel('Quantidade').fill('2');
    await page.getByLabel('Preço unitário').fill('75');
    await page.getByLabel('Desconto').fill('10');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/items') && response.request().method() === 'POST' && response.status() === 201),
      page.getByRole('button', { name: 'Adicionar item' }).click(),
    ]);

    const heading = await page.getByRole('heading', { name: /^Venda \d+$/ }).textContent();
    const saleNumber = heading!.replace('Venda ', '').trim();
    await expect(page.getByText(description)).toBeVisible();
    await expect(page.getByText(/Total: R\$\s*140,00/)).toBeVisible();

    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('dialog')).toContainText('O estoque das peças vendidas será baixado');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/confirm') && response.request().method() === 'POST' && response.status() === 200),
      page.getByRole('button', { name: 'Confirmar venda' }).click(),
    ]);
    await expect(page.getByText('Confirmado')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adicionar item' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Confirmado')).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar venda' }).click();
    await expect(page.getByRole('dialog')).toContainText('O estoque das peças vendidas será estornado');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/cancel') && response.request().method() === 'POST' && response.status() === 200),
      page.getByRole('button', { name: 'Cancelar venda' }).last().click(),
    ]);
    await expect(page.getByText('Cancelado')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancelar venda' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adicionar item' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Cancelado')).toBeVisible();

    await page.goto('/app/sales');
    await page.getByPlaceholder('Número ou cliente').fill(saleNumber);
    await page.waitForResponse((response) => response.url().includes('/sales?') && response.url().includes(`search=${saleNumber}`));
    const row = page.getByRole('row', { name: new RegExp(`#${saleNumber}.*${SEED_CUSTOMER}.*R\\$\\s*140,00`) });
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(/\/app\/sales\/[0-9a-f-]+$/);
    await expect(page.getByText(description)).toBeVisible();
    await expect(page.getByText(/Total: R\$\s*140,00/)).toBeVisible();
  });
});
