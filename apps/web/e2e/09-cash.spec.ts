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
    await expect(page.getByRole('heading', { name: registerName, exact: true })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: registerName, exact: true })).toBeVisible();
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
    // primeiro por NOME — GET /cash-registers ordena `order by r.name`) — como execuções
    // anteriores desta suíte (e de sessões manuais de teste) deixam muitos outros caixas
    // cadastrados no mesmo tenant (centenas, em bases de desenvolvimento de longa duração), o
    // teste precisa reselecionar explicitamente o próprio.
    //
    // SAN-01, seção 3 do correio.md: a versão anterior (`if (await
    // registerSelect.isVisible().catch(() => false))`) tinha uma corrida real, não uma regra da
    // aplicação — `isVisible()` é uma checagem instantânea, e o `<select>` só existe no DOM
    // depois que `GET /cash-registers` resolve (a página começa com `registers=[]`, e o próprio
    // componente só renderiza o seletor quando há mais de um caixa). Rodando cedo o bastante,
    // antes da resposta chegar, `isVisible()` via `false` e o teste pulava a reseleção
    // inteira — sem re-selecionar, o `<select>` (que carrega segundos depois) assume o primeiro
    // caixa em ordem alfabética entre todos os cadastrados, quase nunca o deste teste. A correção
    // espera pela PRÓPRIA opção deste caixa aparecer no `<select>` (o que só acontece depois que
    // a lista carrega) antes de selecionar — sem essa corrida, o `<select>` está sempre visível
    // na prática (basta mais de um caixa existir, o que é sempre verdade aqui).
    await page.locator('a[href="/app/cash"]').first().click();
    await page.waitForURL('**/app/cash');
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    const registerSelect = page.getByLabel('Caixa selecionado');
    await expect(registerSelect.locator('option', { hasText: registerName })).toHaveCount(1);
    await registerSelect.selectOption({ label: registerName });
    await expect(page.getByRole('heading', { name: registerName, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();
    const closeDialog = page.getByRole('dialog');
    await expect(closeDialog).toBeVisible();
    await expect(closeDialog.getByRole('heading', { name: 'Fechar caixa' })).toBeVisible();
    // CAI-03: uma divergência exige justificativa e permanece disponível na conferência
    // histórica, sem alterar os movimentos que compõem o saldo esperado.
    await closeDialog.getByLabel('Valor contado (R$)').fill('99');
    await expect(closeDialog.getByLabel('Justificativa da divergência')).toBeVisible();
    const closingJustification = `Diferença conferida no E2E ${suffix}`;
    await closeDialog.getByLabel('Justificativa da divergência').fill(closingJustification);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/close')),
      closeDialog.getByRole('button', { name: 'Fechar caixa', exact: true }).click(),
    ]);
    await expect(closeDialog).toBeHidden();
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: registerName, exact: true })).toBeVisible();
    await expect(statusBadge).toHaveText('Fechado');
    await expect(page.getByRole('button', { name: 'Abrir caixa' })).toBeVisible();
    await expect(page.getByText(closingJustification)).toBeVisible();

    // CAI-04: o fechamento usa o mesmo detalhe canônico, traz a composição e oferece a
    // impressão nativa do navegador sem gerar ou persistir um segundo documento financeiro.
    await page.getByRole('button', { name: 'Ver fechamento' }).click();
    await page.waitForURL(/\/app\/cash\/sessions\/[0-9a-f-]+$/);
    const closedSessionId = page.url().split('/').at(-1)!;
    await expect(page.getByRole('heading', { name: 'Resumo financeiro' })).toBeVisible();
    await expect(page.getByText('Comprovante de fechamento de caixa')).toBeVisible();
    await expect(page.getByText(closingJustification)).toBeVisible();
    await expect(page.getByRole('cell', { name: /Dinheiro \(cash\)/ })).toBeVisible();
    await page.evaluate(() => { window.print = () => { document.body.dataset.printInvoked = 'true'; }; });
    await page.getByRole('button', { name: 'Imprimir fechamento' }).click();
    await expect.poll(() => page.locator('body').getAttribute('data-print-invoked')).toBe('true');

    // CAI-05: a referência estável localiza a sessão na consulta branch-scoped sem depender do
    // caixa atualmente selecionado para operação.
    await page.getByRole('button', { name: 'Voltar ao caixa' }).click();
    await page.waitForURL('**/app/cash');
    await expect(page.getByLabel('Caixa do histórico')).toHaveValue('');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/cash-sessions?') && response.url().includes(`sessionReference=${closedSessionId}`)),
      page.getByLabel('Referência da sessão').fill(closedSessionId),
    ]);
    await expect(page.getByTitle(closedSessionId)).toHaveText(closedSessionId.slice(0, 8));
  });
});
