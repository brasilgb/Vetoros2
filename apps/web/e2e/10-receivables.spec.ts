import { test, expect, login, selectContextFromHeader, SEED_CUSTOMER } from './fixtures';

// FIN-02 — fluxo financeiro principal (correio.md, seção 21: "Criar E2E do fluxo financeiro
// principal"): confirma uma venda, gera o parcelamento (2 parcelas), registra um recebimento
// vinculado à venda (Financeiro > Recebimentos, mesmo fluxo do FIN-01) e aloca esse recebimento à
// primeira parcela, verificando que ela — e só ela — vira "Quitado". Segue o mesmo padrão de
// 09-cash.spec.ts: cria os próprios registros com um sufixo único por execução, diálogos sempre
// escopados a `page.getByRole('dialog')`.
const suffix = Date.now().toString(36);

test.describe('FIN-02 — contas a receber', () => {
  test('confirma uma venda, gera parcelamento, recebe e aloca o pagamento à primeira parcela', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await selectContextFromHeader(page);

    // 1) cria e confirma uma venda de R$ 600,00 (1 serviço)
    await page.goto('/app/sales/new');
    await page.getByLabel('Cliente (opcional)').fill(SEED_CUSTOMER);
    await expect(page.getByRole('option', { name: SEED_CUSTOMER })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/sales') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Criar venda' }).click(),
    ]);
    await page.waitForURL(/\/app\/sales\/[0-9a-f-]+$/);
    await page.getByLabel('Tipo').selectOption({ label: 'Serviço' });
    await page.getByLabel('Descrição').fill(`Serviço FIN-02 ${suffix}`);
    await page.getByLabel('Quantidade').fill('1');
    await page.getByLabel('Preço unitário').fill('600');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/items') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Adicionar item' }).click(),
    ]);
    const saleHeading = await page.getByRole('heading', { name: /^Venda \d+$/ }).textContent();
    const saleNumber = saleHeading!.replace('Venda ', '').trim();
    await page.getByRole('button', { name: 'Confirmar' }).click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/confirm')),
      confirmDialog.getByRole('button', { name: 'Confirmar venda' }).click(),
    ]);
    await expect(page.getByText('Confirmado')).toBeVisible();

    // 2) gera o parcelamento (2x R$ 300,00) a partir de Financeiro > Contas a Receber
    await page.locator('a[href="/app/receivables"]').first().click();
    await page.waitForURL('**/app/receivables');
    await expect(page.getByRole('heading', { name: 'Contas a Receber' })).toBeVisible();
    await page.getByRole('button', { name: 'Gerar parcelamento' }).click();
    const generateDialog = page.getByRole('dialog');
    await expect(generateDialog).toBeVisible();
    const saleOptionPattern = new RegExp(`^Venda #${saleNumber}( |$)`);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/sales?') && response.url().includes(`search=${saleNumber}`)),
      generateDialog.getByLabel('Venda').fill(saleNumber),
    ]);
    // a base de desenvolvimento acumula vendas de execuções anteriores — confirma exatamente UMA
    // opção com este número antes de selecionar por teclado (mesmo padrão de
    // 03-customer-combobox.spec.ts), e confirma o valor final do campo, nunca "a primeira da
    // lista" às cegas.
    await expect(generateDialog.getByRole('option', { name: saleOptionPattern })).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(generateDialog.getByLabel('Venda')).toHaveValue(`Venda #${saleNumber}`);
    await expect(generateDialog.getByText('A financiar:')).toBeVisible();
    const rows = generateDialog.locator('input[type="number"]');
    await rows.nth(0).fill('300');
    await generateDialog.locator('input[type="date"]').nth(0).fill('2027-01-01');
    await generateDialog.getByRole('button', { name: '+ Parcela' }).click();
    await generateDialog.locator('input[type="number"]').nth(1).fill('300');
    await generateDialog.locator('input[type="date"]').nth(1).fill('2027-02-01');
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/receivables/generate')),
      generateDialog.getByRole('button', { name: 'Gerar' }).click(),
    ]);
    await expect(generateDialog).toBeHidden();
    await expect(page.getByText('Carregando…')).toHaveCount(0);

    // 3) cria/abre um caixa e registra um recebimento de R$ 300,00 vinculado à mesma venda
    await page.locator('a[href="/app/cash"]').first().click();
    await page.waitForURL('**/app/cash');
    const registerName = `Caixa FIN-02 ${suffix}`;
    await page.getByRole('button', { name: 'Novo caixa' }).click();
    const createRegisterDialog = page.getByRole('dialog');
    await createRegisterDialog.getByLabel('Nome').fill(registerName);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/cash-registers') && response.request().method() === 'POST'),
      createRegisterDialog.getByRole('button', { name: 'Criar' }).click(),
    ]);
    await expect(page.getByRole('heading', { name: registerName })).toBeVisible();
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    const openDialog = page.getByRole('dialog');
    await openDialog.getByLabel('Valor inicial (R$)').fill('0');
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/cash-sessions/open')),
      openDialog.getByRole('button', { name: 'Abrir caixa' }).click(),
    ]);
    await expect(page.getByRole('button', { name: 'Registrar recebimento' })).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/app\/payments\?new=1&cashSessionId=.+/),
      page.getByRole('button', { name: 'Registrar recebimento' }).click(),
    ]);
    const receiveDialog = page.getByRole('dialog');
    await receiveDialog.getByLabel('Valor (R$)').fill('300');
    await receiveDialog.getByLabel('Forma de pagamento').selectOption({ label: 'Dinheiro' });
    await receiveDialog.getByLabel('Origem').selectOption({ label: 'Venda' });
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/sales?') && response.url().includes(`search=${saleNumber}`)),
      receiveDialog.getByLabel('Venda').fill(saleNumber),
    ]);
    await expect(receiveDialog.getByRole('option', { name: saleOptionPattern })).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(receiveDialog.getByLabel('Venda')).toHaveValue(`Venda #${saleNumber}`);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/payments') && response.request().method() === 'POST'),
      receiveDialog.getByRole('button', { name: 'Registrar' }).click(),
    ]);
    await page.waitForURL('**/app/payments');

    // 4) volta a Contas a Receber, abre a primeira parcela e aloca o pagamento
    await page.locator('a[href="/app/receivables"]').first().click();
    await page.waitForURL('**/app/receivables');
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Número, cliente…' }).fill(saleNumber);
    await page.waitForResponse((response) => response.url().includes('/receivables?') && response.url().includes('q='));
    const firstInstallmentRow = page.getByRole('row', { name: new RegExp(`Venda #${saleNumber}( |$).*1/2`) });
    await expect(firstInstallmentRow).toBeVisible();
    await firstInstallmentRow.click();
    await page.waitForURL(/\/app\/receivables\/[0-9a-f-]+$/);
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await page.getByRole('button', { name: 'Alocar pagamento' }).click();
    const allocateDialog = page.getByRole('dialog', { name: 'Alocar pagamento' });
    await expect(allocateDialog).toBeVisible();
    await allocateDialog.getByLabel('Recebimento').fill('Dinheiro');
    // o popover deste combobox é anexado via portal fora da subárvore do <dialog> nativo
    // (diferente dos combobox de "Venda" acima, cujo popover fica dentro) — verificado na
    // opção correta (rótulo único: valor + forma + timestamp) sem escopar ao diálogo.
    await expect(page.getByRole('option', { name: /R\$ 300,00 — Dinheiro/ })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await allocateDialog.getByLabel('Valor a alocar (R$)').fill('300');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/allocate')),
      allocateDialog.getByRole('button', { name: 'Alocar' }).click(),
    ]);
    await expect(allocateDialog).toBeHidden();
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    // "Quitado" aparece duas vezes de propósito: o badge de status do cabeçalho E a própria linha
    // desta parcela na tabela de parcelamento (seção 19: a interface mostra de onde veio cada
    // valor) — `.first()` basta para confirmar que o status mudou.
    await expect(page.getByText('Quitado').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0); // título já pago não pode mais ser cancelado

    // a segunda parcela (mesma origem) continua "Em aberto", visível na tabela de parcelamento
    // (a primeira das duas tabelas da página — a segunda é "Pagamentos alocados").
    const siblingsTable = page.locator('table').first();
    await expect(siblingsTable.getByText('Em aberto')).toBeVisible();
  });
});
