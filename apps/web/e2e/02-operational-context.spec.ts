import { test, expect, login, selectContextFromHeader } from './fixtures';

// Seção 15.2 do correio.md UX-03.
test.describe('contexto operacional', () => {
  test('bloqueia módulo operacional sem Empresa/Filial, orienta, e libera o conteúdo após selecionar', async ({ page }) => {
    await login(page);
    await page.goto('/app/service-orders');

    // 1) sem contexto: aviso proativo, não o formulário/tabela tentando carregar
    await expect(page.getByText('Selecione uma empresa e uma filial')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ordens de Serviço' })).toBeHidden();

    // 2) clicar no botão do aviso foca o seletor certo (desktop: cabeçalho)
    await page.getByRole('button', { name: 'Selecionar Empresa/Filial' }).click();
    await expect(page.locator('header select[aria-label="Empresa ativa (cabeçalho)"]')).toBeFocused();

    // 3) selecionar contexto libera o conteúdo
    await selectContextFromHeader(page);
    await expect(page.getByRole('heading', { name: 'Ordens de Serviço' })).toBeVisible();
    await expect(page.getByText('Selecione uma empresa e uma filial')).toBeHidden();

    // contexto (empresa e filial) fica identificável no cabeçalho (seção 13)
    await expect(page.locator('header select[aria-label="Empresa ativa (cabeçalho)"]')).toHaveValue(/.+/);
    await expect(page.locator('header select[aria-label="Filial ativa (cabeçalho)"]')).toHaveValue(/.+/);
  });
});
