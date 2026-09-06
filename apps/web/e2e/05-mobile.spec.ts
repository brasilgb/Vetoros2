import { test, expect, login, SEED_COMPANY, SEED_BRANCH } from './fixtures';

// Seção 15.5 do correio.md UX-03.
test.describe('mobile (~390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('drawer, seleção de contexto pelo menu, e sem overflow horizontal', async ({ page }) => {
    await login(page);

    // a ausência de contexto num módulo operacional também é proativa no mobile
    await page.goto('/app/service-orders');
    await expect(page.getByText('Selecione uma empresa e uma filial')).toBeVisible();
    await page.getByRole('button', { name: 'Selecionar Empresa/Filial' }).click();

    // no mobile, o botão abre o drawer (confirmado pelo backdrop) e foca o seletor de lá — não
    // o do cabeçalho, que fica escondido
    await expect(page.getByTestId('mobile-backdrop')).toBeVisible();
    const drawerCompanySelect = page.locator('select[aria-label="Empresa ativa (menu)"]');
    await expect(drawerCompanySelect).toBeFocused();

    await drawerCompanySelect.selectOption({ label: SEED_COMPANY });
    await page.locator('select[aria-label="Filial ativa (menu)"]').selectOption({ label: SEED_BRANCH });

    // navega por um link do próprio drawer — fecha o drawer e carrega o módulo
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Clientes' }).click();
    await expect(page).toHaveURL(/\/app\/customers$/);
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await expect(page.getByTestId('mobile-backdrop')).toHaveCount(0);

    // sem scroll horizontal da página (o que existir de tabela larga deve rolar por dentro, não a página)
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
  });
});
