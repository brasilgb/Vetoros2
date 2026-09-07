import { test, expect, login, selectContextFromHeader } from './fixtures';

// FIN-04 — fluxo financeiro principal (correio.md, seção 30): login, acessar Financeiro, abrir
// Contas Financeiras, criar uma conta, conferir listagem, abrir detalhe, registrar crédito,
// verificar saldo, registrar débito, verificar saldo, criar segunda conta, transferir valor,
// verificar débito da origem/crédito no destino, estornar a transferência (operação suportada
// pelo contrato — seção 9), validar histórico. Mesmo padrão de 09-cash.spec.ts/11-payables.spec.ts:
// dados próprios com sufixo único por execução, diálogos sempre escopados a
// `page.getByRole('dialog')`, nenhum sleep arbitrário — só waits determinísticos
// (`waitForResponse`/`waitForURL`/asserções de visibilidade).
const suffix = Date.now().toString(36);

test.describe('FIN-04 — contas financeiras e tesouraria', () => {
  test('cria contas financeiras, lança crédito/débito, transfere entre contas e estorna', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await selectContextFromHeader(page);

    // 1/2/3) acessa Financeiro > Contas Financeiras a partir da sidebar
    await page.locator('a[href="/app/financial-accounts"]').first().click();
    await page.waitForURL('**/app/financial-accounts');
    await expect(page.getByRole('heading', { name: 'Contas Financeiras' })).toBeVisible();

    // 4) cria a primeira conta — página dedicada, nunca modal (correio.md, seção 25.2)
    const accountOneName = `Conta E2E Origem ${suffix}`;
    await page.getByRole('link', { name: 'Nova conta financeira' }).click();
    await page.waitForURL('**/app/financial-accounts/new');
    await page.getByLabel('Nome').fill(accountOneName);
    await page.getByLabel('Banco', { exact: true }).fill('Banco E2E');
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/financial-accounts') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Criar conta financeira' }).click(),
    ]);
    await page.waitForURL(/\/app\/financial-accounts\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: accountOneName })).toBeVisible();

    // 5) volta à listagem e confirma que a conta aparece, ativa, saldo zero
    await page.locator('a[href="/app/financial-accounts"]').first().click();
    await page.waitForURL('**/app/financial-accounts');
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Nome, banco, número da conta…' }).fill(accountOneName);
    await page.waitForResponse((response) => response.url().includes('/financial-accounts?') && response.url().includes('q='));
    const listedRow = page.getByRole('row', { name: new RegExp(accountOneName) });
    await expect(listedRow).toBeVisible();
    await expect(listedRow.getByText('Ativa')).toBeVisible();

    // 6) abre o detalhe
    await listedRow.click();
    await page.waitForURL(/\/app\/financial-accounts\/[0-9a-f-]+$/);
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    const balanceLabel = page.locator('#d-balance');
    await expect(balanceLabel).toHaveText('R$ 0,00');

    // 7) registra um crédito manual
    await page.getByRole('button', { name: 'Lançar crédito' }).click();
    const creditDialog = page.getByRole('dialog', { name: 'Lançar crédito' });
    await expect(creditDialog).toBeVisible();
    await creditDialog.getByLabel('Valor (R$)').fill('1000');
    await creditDialog.getByLabel('Descrição').fill(`Depósito E2E ${suffix}`);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/transactions') && response.request().method() === 'POST'),
      creditDialog.getByRole('button', { name: 'Lançar' }).click(),
    ]);
    await expect(creditDialog).toBeHidden();

    // 8) verifica saldo após o crédito
    await expect(balanceLabel).toHaveText('R$ 1.000,00');

    // 9) registra um débito manual
    await page.getByRole('button', { name: 'Lançar débito' }).click();
    const debitDialog = page.getByRole('dialog', { name: 'Lançar débito' });
    await expect(debitDialog).toBeVisible();
    await debitDialog.getByLabel('Valor (R$)').fill('150');
    await debitDialog.getByLabel('Descrição').fill(`Tarifa E2E ${suffix}`);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/transactions') && response.request().method() === 'POST'),
      debitDialog.getByRole('button', { name: 'Lançar' }).click(),
    ]);
    await expect(debitDialog).toBeHidden();

    // 10) verifica saldo após o débito
    await expect(balanceLabel).toHaveText('R$ 850,00');

    // 11) cria a segunda conta (destino da transferência)
    const accountTwoName = `Conta E2E Destino ${suffix}`;
    await page.locator('a[href="/app/financial-accounts"]').first().click();
    await page.waitForURL('**/app/financial-accounts');
    await page.getByRole('link', { name: 'Nova conta financeira' }).click();
    await page.waitForURL('**/app/financial-accounts/new');
    await page.getByLabel('Nome').fill(accountTwoName);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/financial-accounts') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Criar conta financeira' }).click(),
    ]);
    await page.waitForURL(/\/app\/financial-accounts\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: accountTwoName })).toBeVisible();

    // 12) volta à primeira conta e transfere um valor para a segunda
    await page.locator('a[href="/app/financial-accounts"]').first().click();
    await page.waitForURL('**/app/financial-accounts');
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Nome, banco, número da conta…' }).fill(accountOneName);
    await page.waitForResponse((response) => response.url().includes('/financial-accounts?') && response.url().includes('q='));
    await page.getByRole('row', { name: new RegExp(accountOneName) }).click();
    await page.waitForURL(/\/app\/financial-accounts\/[0-9a-f-]+$/);
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await expect(balanceLabel).toHaveText('R$ 850,00');

    await page.getByRole('button', { name: 'Transferir' }).click();
    const transferDialog = page.getByRole('dialog', { name: 'Transferir' });
    await expect(transferDialog).toBeVisible();
    await expect(transferDialog.getByLabel('Conta de destino').locator('option', { hasText: accountTwoName })).toHaveCount(1);
    await transferDialog.getByLabel('Conta de destino').selectOption({ label: accountTwoName });
    await transferDialog.getByLabel('Valor (R$)').fill('300');
    await transferDialog.getByLabel('Descrição').fill(`Transferência E2E ${suffix}`);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/transfer') && response.request().method() === 'POST'),
      transferDialog.getByRole('button', { name: 'Transferir' }).click(),
    ]);
    await expect(transferDialog).toBeHidden();

    // 13) verifica débito na origem
    await expect(balanceLabel).toHaveText('R$ 550,00');

    // 14) verifica crédito no destino
    await page.locator('a[href="/app/financial-accounts"]').first().click();
    await page.waitForURL('**/app/financial-accounts');
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Nome, banco, número da conta…' }).fill(accountTwoName);
    await page.waitForResponse((response) => response.url().includes('/financial-accounts?') && response.url().includes('q='));
    await page.getByRole('row', { name: new RegExp(accountTwoName) }).click();
    await page.waitForURL(/\/app\/financial-accounts\/[0-9a-f-]+$/);
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await expect(balanceLabel).toHaveText('R$ 300,00');

    // 15) estorna a transferência (operação suportada pelo contrato — seção 9: reversão atômica
    // das duas pernas) a partir do histórico de movimentações desta própria conta (destino).
    const movementsSection = page.locator('fieldset', { hasText: 'Movimentações' });
    await movementsSection.getByRole('button', { name: 'Estornar' }).click();
    const reverseDialog = page.getByRole('dialog', { name: 'Estornar transferência' });
    await expect(reverseDialog).toBeVisible();
    await reverseDialog.getByLabel('Motivo (opcional)').fill(`Estorno E2E ${suffix}`);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/financial-transfers/') && response.url().includes('/reverse')),
      reverseDialog.getByRole('button', { name: 'Estornar' }).click(),
    ]);
    await expect(reverseDialog).toBeHidden();

    // 16) valida histórico: o saldo do destino volta a zero, a transferência original aparece
    // marcada "Estornado" e o próprio lançamento de estorno (origem "Estorno") passa a existir no
    // histórico — nunca uma edição do lançamento original.
    await expect(balanceLabel).toHaveText('R$ 0,00');
    await expect(movementsSection.getByText('Estornado')).toBeVisible();
    await expect(movementsSection.getByRole('cell', { name: 'Estorno', exact: true })).toBeVisible();
  });
});
