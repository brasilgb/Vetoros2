import { test, expect, login, selectContextFromHeader } from './fixtures';

// FIN-03 — fluxo financeiro principal (correio.md, seção 18.3: "Criar E2E do fluxo principal de
// Contas a Pagar"): abre Contas a Pagar, cria uma conta manual com 2 parcelas (página dedicada,
// não modal — seção 17.2), confirma na listagem, abre o detalhe, registra um pagamento parcial
// (primeira parcela), verifica saldo/situação, estorna esse pagamento, verifica que o saldo
// volta ao valor original e, só então — sem nenhum pagamento ativo — cancela a conta. Mesmo
// padrão de 10-receivables.spec.ts: dados próprios com sufixo único por execução, diálogos
// sempre escopados a `page.getByRole('dialog')`.
const suffix = Date.now().toString(36);

test.describe('FIN-03 — contas a pagar', () => {
  test('cria uma conta a pagar, registra pagamento, estorna e cancela', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await selectContextFromHeader(page);

    // 1) abre Contas a Pagar a partir do grupo "Financeiro" da sidebar
    await page.locator('a[href="/app/payables"]').first().click();
    await page.waitForURL('**/app/payables');
    await expect(page.getByRole('heading', { name: 'Contas a Pagar' })).toBeVisible();

    // 2) cria uma conta manual (sem fornecedor/pedido) com 2 parcelas de R$ 250,00 — página
    // dedicada, nunca modal (correio.md, seção 17.2).
    const description = `Conta E2E ${suffix}`;
    await page.getByRole('link', { name: 'Nova conta a pagar' }).click();
    await page.waitForURL('**/app/payables/new');
    await expect(page.getByLabel('Tipo')).toHaveValue('manual');
    await page.getByLabel('Descrição').fill(description);
    const installmentsSection = page.locator('fieldset', { hasText: 'Parcelamento' });
    await installmentsSection.getByPlaceholder('Valor (R$)').nth(0).fill('250');
    await installmentsSection.locator('input[type="date"]').nth(0).fill('2027-01-01');
    await installmentsSection.getByRole('button', { name: '+ Parcela' }).click();
    await installmentsSection.getByPlaceholder('Valor (R$)').nth(1).fill('250');
    await installmentsSection.locator('input[type="date"]').nth(1).fill('2027-02-01');
    await expect(page.getByText('Soma atual: R$ 500,00')).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/payables') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Criar conta a pagar' }).click(),
    ]);
    await page.waitForURL(/\/app\/payables\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: description })).toBeVisible();

    // 3) volta à listagem e confirma que a conta aparece (situação "Em aberto")
    await page.locator('a[href="/app/payables"]').first().click();
    await page.waitForURL('**/app/payables');
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Descrição, documento, fornecedor, pedido…' }).fill(description);
    await page.waitForResponse((response) => response.url().includes('/payables?') && response.url().includes('q='));
    const row = page.getByRole('row', { name: new RegExp(description) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Em aberto')).toBeVisible();

    // 4) abre o detalhe e registra um pagamento parcial (primeira parcela, R$ 250,00 de R$ 500,00)
    await row.click();
    await page.waitForURL(/\/app\/payables\/[0-9a-f-]+$/);
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await expect(page.getByText('R$ 500,00').first()).toBeVisible(); // valor original do título
    const installmentsTable = page.locator('table').first();
    const firstInstallmentRow = installmentsTable.getByRole('row', { name: /^1\/2/ });
    await firstInstallmentRow.getByRole('button', { name: 'Pagar' }).click();
    const payDialog = page.getByRole('dialog', { name: 'Registrar pagamento' });
    await expect(payDialog).toBeVisible();
    await expect(payDialog.getByLabel('Valor (R$)')).toHaveValue('250.00');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/payments') && response.request().method() === 'POST'),
      payDialog.getByRole('button', { name: 'Registrar' }).click(),
    ]);
    await expect(payDialog).toBeHidden();

    // 5) confirma saldo/situação: R$ 250,00 pagos, R$ 250,00 de saldo, situação "Parcial"
    await expect(page.getByText('Parcial').first()).toBeVisible();
    await expect(firstInstallmentRow.getByText('Quitada')).toBeVisible();

    // 6) estorna o pagamento — pede confirmação/motivo (diálogo próprio) e reabre o saldo
    const paymentsSection = page.locator('fieldset', { hasText: 'Pagamentos' });
    await paymentsSection.getByRole('button', { name: 'Estornar' }).click();
    const reverseDialog = page.getByRole('dialog', { name: 'Estornar pagamento' });
    await expect(reverseDialog).toBeVisible();
    await reverseDialog.getByLabel('Motivo (opcional)').fill(`Estorno E2E ${suffix}`);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/reverse')),
      reverseDialog.getByRole('button', { name: 'Estornar' }).click(),
    ]);
    await expect(reverseDialog).toBeHidden();

    // 7) o saldo volta ao valor original e a situação volta a "Em aberto" — o pagamento original
    // continua no histórico (nunca é apagado), agora marcado "Estornado", com o lançamento de
    // estorno logo ao lado.
    await expect(page.getByText('Em aberto').first()).toBeVisible();
    await expect(firstInstallmentRow.getByText('Em aberto')).toBeVisible();
    await expect(paymentsSection.getByText('Estornado')).toBeVisible();
    await expect(paymentsSection.getByText('Estorno', { exact: true })).toBeVisible();

    // 8) sem nenhum pagamento ativo, o cancelamento agora é permitido
    await page.getByRole('button', { name: 'Cancelar' }).click();
    const cancelDialog = page.getByRole('dialog', { name: 'Cancelar conta a pagar' });
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.getByLabel('Motivo (opcional)').fill(`Cancelamento E2E ${suffix}`);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/cancel')),
      cancelDialog.getByRole('button', { name: 'Cancelar conta' }).click(),
    ]);
    await expect(cancelDialog).toBeHidden();
    await expect(page.getByText('Cancelado').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0); // já cancelada, ação não faz mais sentido
  });
});
