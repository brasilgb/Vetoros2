import { test, expect, login, selectContextFromHeader, SEED_CUSTOMER } from './fixtures';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Seção 15.3 do correio.md UX-03: buscar Cliente por nome, selecionar, e confirmar que nenhum
// ID é digitado manualmente em nenhum momento do fluxo.
test.describe('seleção de cliente por busca (EntityCombobox)', () => {
  test('Nova OS: busca cliente por nome e seleciona sem digitar UUID', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await selectContextFromHeader(page);

    await page.goto('/app/service-orders/new');

    // não existe mais nenhum campo pedindo "ID" — o rótulo antigo ("Cliente (ID)") sumiu
    await expect(page.getByText('Cliente (ID)')).toHaveCount(0);

    // busca pelo nome completo (a API filtra por prefixo): isola "Cliente Alpha PF" de
    // qualquer outro registro que comece com "Cliente Alpha" (ex.: "Cliente Alpha PJ"). O
    // combobox dispara uma busca já ao focar (query vazia) e outra, com debounce, a cada
    // digitação — esperar explicitamente a resposta da busca filtrada evita agir sobre a lista
    // "de abertura" (que pode conter os dois clientes) antes dela chegar.
    // getByRole('option') sozinho também pegaria as <option> dos <select> nativos de
    // Empresa/Filial do cabeçalho — escopar ao listbox do combobox evita essa ambiguidade.
    const customerField = page.locator('#customerId');
    await Promise.all([page.waitForResponse((response) => response.url().includes('/customers?') && response.url().includes('pageSize=8')), customerField.click()]);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/customers?') && response.url().includes('pageSize=8') && response.url().includes('search=Cliente')),
      customerField.fill(SEED_CUSTOMER),
    ]);
    const listbox = page.getByRole('listbox');
    await expect(listbox.getByRole('option')).toHaveCount(1);
    await expect(listbox.getByRole('option', { name: SEED_CUSTOMER })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // o campo mostra o nome do cliente, não um UUID — a seleção guardou o ID internamente
    await expect(customerField).toHaveValue(SEED_CUSTOMER);
    await expect(customerField).not.toHaveValue(UUID_PATTERN);

    // equipamento libera assim que o cliente é escolhido, e continua sem pedir ID
    await expect(page.locator('#assetId')).toBeEnabled();
    await expect(page.getByText('Equipamento (ID')).toHaveCount(0);
  });
});
