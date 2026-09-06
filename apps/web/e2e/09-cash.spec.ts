import { test, expect, login, selectContextFromHeader } from './fixtures';

// FIN-01 — fluxo principal (correio.md, seção 19: "Criar E2E do fluxo principal"): criar um
// caixa, abrir, registrar um recebimento avulso, ver na listagem de Recebimentos, abrir o
// detalhe, estornar, voltar ao Caixa e fechar. Segue o mesmo padrão de 08-audit.spec.ts — cria
// os próprios registros com um sufixo único por execução em vez de depender de estado prévio do
// banco (caixas/sessões/recebimentos não têm exclusão, então não há limpeza a fazer no final).
// Ações dentro de diálogo são sempre escopadas a `page.getByRole('dialog')` (mesmo padrão de
// 04-confirm-dialog.spec.ts) — o rótulo do botão que abre o diálogo é, por design (seção 15/16),
// o MESMO texto do botão de confirmação dentro dele ("Abrir caixa", "Fechar caixa"), então uma
// busca por texto sem esse escopo pega o elemento errado.
const suffix = Date.now().toString(36);

test.describe('FIN-01 — caixa e recebimentos', () => {
  test('cria e abre um caixa, registra um recebimento avulso, vê na listagem, estorna e fecha o caixa', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await selectContextFromHeader(page);

    // 1) abre a tela de Caixa a partir do grupo "Financeiro" da sidebar
    await page.locator('a[href="/app/cash"]').first().click();
    await page.waitForURL('**/app/cash');
    await expect(page.getByRole('heading', { name: 'Caixa' })).toBeVisible();

    // 2) cria um novo caixa
    const registerName = `Caixa E2E ${suffix}`;
    // a lista "Caixas cadastrados" tem uma coluna de status repetindo "Aberto"/"Fechado" para
    // TODOS os caixas já criados por execuções anteriores desta suíte — uma busca solta por esse
    // texto na página inteira é ambígua (strict mode). O badge de status do caixa selecionado é
    // sempre o `<span>` logo depois do `<h2>` com o nome dele, na mesma linha.
    const statusBadge = page.locator('h2', { hasText: registerName }).locator('xpath=following-sibling::span[1]');
    await page.getByRole('button', { name: 'Novo caixa' }).click();
    const createDialog = page.getByRole('dialog');
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel('Nome').fill(registerName);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/cash-registers') && response.request().method() === 'POST'),
      createDialog.getByRole('button', { name: 'Criar' }).click(),
    ]);
    await expect(createDialog).toBeHidden();
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: registerName })).toBeVisible();
    await expect(statusBadge).toHaveText('Fechado');

    // 3) abre o caixa com um valor inicial
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    const openDialog = page.getByRole('dialog');
    await expect(openDialog).toBeVisible();
    await openDialog.getByLabel('Valor inicial (R$)').fill('100');
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/cash-sessions/open')),
      openDialog.getByRole('button', { name: 'Abrir caixa' }).click(),
    ]);
    await expect(openDialog).toBeHidden();
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: registerName })).toBeVisible();
    await expect(statusBadge).toHaveText('Aberto');
    const expectedBalance = page.getByText('Saldo esperado').locator('xpath=following-sibling::p[1]');
    await expect(expectedBalance).toHaveText('R$ 100,00');

    // 4) registra um recebimento avulso a partir da própria tela de Caixa
    await Promise.all([
      page.waitForURL(/\/app\/payments\?new=1&cashSessionId=.+/),
      page.getByRole('button', { name: 'Registrar recebimento' }).click(),
    ]);
    const receiveDialog = page.getByRole('dialog');
    await expect(receiveDialog).toBeVisible();
    await expect(receiveDialog.getByRole('heading', { name: 'Novo recebimento' })).toBeVisible();
    await receiveDialog.getByLabel('Valor (R$)').fill('45.50');
    await receiveDialog.getByLabel('Forma de pagamento').selectOption({ label: 'Dinheiro' });
    const observationMarker = `Recebimento E2E ${suffix}`;
    await receiveDialog.getByLabel('Observação (opcional)').fill(observationMarker);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/payments') && response.request().method() === 'POST'),
      receiveDialog.getByRole('button', { name: 'Registrar' }).click(),
    ]);
    await page.waitForURL('**/app/payments');
    await expect(page.getByText('Carregando…')).toHaveCount(0);

    // 5) localiza o recebimento na listagem — a busca textual pela observação isola exatamente
    // este recebimento (o valor sozinho não é único: execuções anteriores desta suíte também
    // registraram R$ 45,50). Valor e forma de pagamento corretos, sem UUID exibido como
    // informação principal, status "Ativo".
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/payments?') && response.url().includes('q=')),
      page.getByRole('searchbox', { name: 'Número, cliente, observação…' }).fill(observationMarker),
    ]);
    const row = page.getByRole('row', { name: /R\$\s?45,50/ });
    await expect(row).toBeVisible();
    await expect(row.getByText('Avulso')).toBeVisible();
    await expect(row.getByText('Dinheiro')).toBeVisible();
    await expect(row.getByText('Ativo')).toBeVisible();
    await expect(page.getByText(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)).toHaveCount(0);

    // 6) abre o detalhe e estorna
    await row.click();
    await page.waitForURL(/\/app\/payments\/[0-9a-f-]+$/);
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await expect(page.getByText('R$ 45,50')).toBeVisible();
    await page.getByRole('button', { name: 'Estornar' }).click();
    const refundDialog = page.getByRole('dialog');
    await expect(refundDialog).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/refund')),
      refundDialog.getByRole('button', { name: 'Estornar', exact: true }).click(),
    ]);
    await expect(refundDialog).toBeHidden();
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await expect(page.getByText('Estornado')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Estornar' })).toHaveCount(0); // não pode estornar de novo

    // 7) volta ao Caixa e fecha — saldo esperado reflete o recebimento estornado (de volta a R$ 100).
    // A tela reabre sem lembrar qual caixa estava selecionado (novo mount, seleção volta ao
    // primeiro por nome) — como execuções anteriores desta suíte deixam outros caixas
    // cadastrados no mesmo tenant, o teste precisa reselecionar explicitamente o próprio, em vez
    // de assumir que ele continua em foco.
    await page.locator('a[href="/app/cash"]').first().click();
    await page.waitForURL('**/app/cash');
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    const registerSelect = page.getByLabel('Caixa selecionado');
    if (await registerSelect.isVisible().catch(() => false)) await registerSelect.selectOption({ label: registerName });
    await expect(page.getByRole('heading', { name: registerName })).toBeVisible();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();
    const closeDialog = page.getByRole('dialog');
    await expect(closeDialog).toBeVisible();
    await expect(closeDialog.getByRole('heading', { name: 'Fechar caixa' })).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/close')),
      closeDialog.getByRole('button', { name: 'Fechar caixa', exact: true }).click(),
    ]);
    await expect(closeDialog).toBeHidden();
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: registerName })).toBeVisible();
    await expect(statusBadge).toHaveText('Fechado');
    await expect(page.getByRole('button', { name: 'Abrir caixa' })).toBeVisible();
  });
});
