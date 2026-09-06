import { test, expect, login, selectContextFromHeader } from './fixtures';

// Seção 22 do correio.md ADM-03. Gera o próprio evento dentro do teste (marcador único por
// execução) em vez de depender de estado prévio do banco.
const suffix = Date.now().toString(36);

test.describe('ADM-03 — auditoria e histórico administrativo', () => {
  test('cria um cliente, localiza o evento na Auditoria, abre o detalhe e confirma ator/ação/mudança; depois filtra e confirma o resultado', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await selectContextFromHeader(page);

    // 2) realiza uma alteração real num domínio já existente
    const customerName = `Cliente Auditoria E2E ${suffix}`;
    await page.goto('/app/customers/new');
    await page.fill('#legalName', customerName);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/customers') && response.request().method() === 'POST'),
      page.locator('button[type="submit"]').click(),
    ]);
    await page.waitForURL(/\/app\/customers\/[0-9a-f-]+$/);

    // 3) abre Administração → Auditoria
    await page.goto('/app');
    await page.getByRole('link', { name: 'Auditoria' }).click();
    await page.waitForURL('**/app/audit-logs');
    await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible();

    // 4) localiza o evento produzido
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/audit-events?') && response.url().includes('q=')),
      page.getByRole('searchbox', { name: 'Ação, entidade, usuário…' }).fill(customerName),
    ]);
    const row = page.getByRole('row', { name: new RegExp(customerName) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Cliente criado')).toBeVisible();
    await expect(row.getByText('Clientes')).toBeVisible();

    // 5) abre o detalhe
    await row.click();
    await page.waitForURL(/\/app\/audit-logs\/[0-9a-f-]+$/);
    await expect(page.getByText('Carregando…')).toHaveCount(0);

    // 6) confirma ator — o login de E2E (seed) é o administrador do tenant Alpha
    await expect(page.getByText('Anderson Brasil (faker)')).toBeVisible();
    await expect(page.getByText('andersonbrasil72@gmail.com')).toBeVisible();
    // 7) confirma ação
    await expect(page.getByRole('heading', { name: 'Cliente criado' })).toBeVisible();
    // 8) confirma pelo menos uma mudança registrada
    await expect(page.getByText('Tipo de pessoa')).toBeVisible();
    await expect(page.getByText('individual')).toBeVisible();
    // nenhum UUID técnico como informação principal
    await expect(page.getByText(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)).toHaveCount(0);

    // 9) volta e aplica um filtro (módulo)
    await page.goto('/app/audit-logs');
    await page.getByRole('searchbox', { name: 'Ação, entidade, usuário…' }).fill(customerName);
    await page.waitForTimeout(400);
    const moduleSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Todos os módulos' }) });
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/audit-events?') && response.url().includes('resourceType=customer')),
      moduleSelect.selectOption({ label: 'Clientes' }),
    ]);
    // 10) confirma resultado — o evento continua visível sob o filtro correto
    await expect(page.getByRole('row', { name: new RegExp(customerName) })).toBeVisible();
    await expect(page.getByText('Limpar 2 filtros')).toBeVisible();

    // um módulo que não tem nada a ver com o evento deve escondê-lo
    await moduleSelect.selectOption({ label: 'Vendas' });
    await page.waitForTimeout(400);
    await expect(page.getByRole('row', { name: new RegExp(customerName) })).toHaveCount(0);
  });
});
