import { test, expect, login, SEED_CUSTOMER } from './fixtures';

// Seção 15.4 do correio.md UX-03. Usa a ação de Ativar/Inativar de Clientes (ConfirmDialog do
// UX-01) sobre um registro seedado — de baixo risco e reversível — e restaura o status
// original ao final, para a suíte poder rodar repetidas vezes sem acumular efeito.
test.describe('dialog de confirmação', () => {
  test('cancelar não tem efeito; confirmar aplica a ação (e é revertida ao final)', async ({ page }) => {
    await login(page);
    await page.goto('/app/customers');
    // esperar a resposta da busca filtrada (não só a linha aparecer) evita agir sobre a lista
    // antes do debounce da busca recarregar a tabela (o que desmontaria a linha/menu no meio
    // da interação, já que a listagem mostra esqueleto durante o carregamento).
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/customers?') && response.url().includes('pageSize=20') && response.url().includes('search=Cliente')),
      page.getByRole('searchbox', { name: 'Nome, documento, contato ou número' }).fill(SEED_CUSTOMER),
    ]);

    const row = page.getByRole('row', { name: new RegExp(SEED_CUSTOMER) });
    await expect(row).toBeVisible();
    const statusBefore = await row.locator('td').nth(3).textContent();

    async function openRowMenuAndPick(actionLabel: string) {
      await row.getByRole('button', { name: /Ações de/ }).click();
      await page.getByRole('menuitem', { name: actionLabel }).click();
    }

    const toggleLabel = statusBefore?.trim() === 'Ativo' ? 'Inativar' : 'Ativar';

    // 1) abre o diálogo e cancela — sem efeito
    await openRowMenuAndPick(toggleLabel);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('td').nth(3)).toHaveText(statusBefore ?? '');

    // 2) abre de novo e confirma — o status muda
    await openRowMenuAndPick(toggleLabel);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: toggleLabel }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('td').nth(3)).not.toHaveText(statusBefore ?? '');

    // 3) restaura o status original, para a próxima execução da suíte encontrar a mesma fixture
    const revertLabel = toggleLabel === 'Inativar' ? 'Ativar' : 'Inativar';
    await openRowMenuAndPick(revertLabel);
    await dialog.getByRole('button', { name: revertLabel }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('td').nth(3)).toHaveText(statusBefore ?? '');
  });
});
