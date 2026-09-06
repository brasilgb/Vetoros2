import { test, expect, login, selectContextFromHeader } from './fixtures';

// Seção 21 do correio.md ADM-02. Dados únicos por execução (timestamp).
const suffix = Date.now().toString(36);

test.describe('ADM-02 — papéis e permissões', () => {
  test('cria papel personalizado, marca permissões, salva, recarrega e confirma persistência; depois altera e atribui a um usuário', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await page.getByRole('link', { name: 'Papéis e Permissões' }).click();
    await page.waitForURL('**/app/roles');
    await expect(page.getByRole('heading', { name: 'Papéis e Permissões' })).toBeVisible();

    await page.goto('/app/roles/new');
    const roleName = `Supervisor de Oficina ${suffix}`;
    await page.fill('#name', roleName);
    // marca "Visualizar" e "Criar" de Clientes — sem digitar nenhum código técnico ou UUID
    const clientesGroup = page.locator('h3', { hasText: 'CLIENTES' }).locator('..');
    await clientesGroup.getByRole('checkbox', { name: 'Visualizar', exact: true }).check();
    await clientesGroup.getByRole('checkbox', { name: 'Criar', exact: true }).check();
    await expect(page.getByText('service_orders.read')).toHaveCount(0);
    await expect(page.getByText(/^[0-9a-f]{8}-[0-9a-f]{4}-/)).toHaveCount(0);

    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/roles') && response.request().method() === 'POST'),
      page.locator('button:has-text("Criar papel")').click(),
    ]);
    const roleId = (await createResponse.json()).id as string;
    await page.waitForURL(/\/app\/roles\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: roleName })).toBeVisible();

    // recarrega e confirma que as duas permissões marcadas persistiram
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText('Carregando…')).toHaveCount(0);
    const clientesGroupAfterReload = page.locator('h3', { hasText: 'CLIENTES' }).locator('..');
    await expect(clientesGroupAfterReload.getByRole('checkbox', { name: 'Visualizar', exact: true })).toBeChecked();
    await expect(clientesGroupAfterReload.getByRole('checkbox', { name: 'Criar', exact: true })).toBeChecked();
    await expect(clientesGroupAfterReload.getByRole('checkbox', { name: 'Alterar', exact: true })).not.toBeChecked();

    // altera a matriz: marca também "Alterar" de Clientes
    await clientesGroupAfterReload.getByRole('checkbox', { name: 'Alterar', exact: true }).check();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/roles/') && response.request().method() === 'PATCH'),
      page.locator('button:has-text("Salvar")').click(),
    ]);
    await page.reload({ waitUntil: 'networkidle' });
    const clientesGroupFinal = page.locator('h3', { hasText: 'CLIENTES' }).locator('..');
    await expect(clientesGroupFinal.getByRole('checkbox', { name: 'Alterar', exact: true })).toBeChecked();

    // atribui esse papel a um novo usuário e confirma na tela do usuário — sem UUID manual
    await page.goto('/app/users/new');
    const userName = `Usuário Papel Custom ${suffix}`;
    const userEmail = `usuario-papel-custom-${suffix}@example.test`;
    await page.fill('#name', userName);
    await page.fill('#email', userEmail);
    await page.locator('#roleId').selectOption({ label: roleName });
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/users') && response.request().method() === 'POST'),
      page.locator('button:has-text("Criar usuário")').click(),
    ]);
    const temporaryPassword = await page.locator('code').textContent();
    expect(temporaryPassword?.length ?? 0).toBeGreaterThanOrEqual(8);
    await page.locator('button:has-text("Já anotei")').click();
    await page.waitForURL(/\/app\/users\/[0-9a-f-]+$/);
    await expect(page.locator('#roleId')).toHaveValue(roleId);

    // prova de autorização positiva e negativa (seção 21.10): loga como o usuário recém-criado,
    // que só tem "Clientes: Visualizar/Criar/Alterar" — Clientes deve funcionar (positiva) e
    // Papéis e Permissões deve ser negado (negativa, sem `users.read`/`users.manage_roles`).
    const otherPage = await page.context().browser()!.newPage();
    try {
      await otherPage.goto('/login');
      await otherPage.getByLabel('E-mail').fill(userEmail);
      await otherPage.getByLabel('Senha').fill(temporaryPassword!);
      await otherPage.getByRole('button', { name: 'Entrar' }).click();
      await otherPage.waitForURL(/\/app/, { timeout: 15_000 });

      await otherPage.goto('/app/customers');
      await expect(otherPage.getByRole('heading', { name: 'Clientes' })).toBeVisible();
      await expect(otherPage.getByText('Acesso negado')).toHaveCount(0);

      await otherPage.goto('/app/roles');
      await expect(otherPage.getByText('Acesso negado')).toBeVisible();
    } finally {
      await otherPage.close();
    }
  });

  test('papel customizado excluído sem uso some da listagem; papel de sistema permanece protegido na UI', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await selectContextFromHeader(page);
    await page.goto('/app/roles');

    // papel de sistema: sem ações destrutivas, só "Ver"
    await page.getByRole('row', { name: /Administrador/ }).getByRole('button', { name: /Ações de/ }).click();
    await expect(page.getByRole('menuitem')).toHaveCount(1);
    await expect(page.getByRole('menuitem', { name: 'Ver' })).toBeVisible();
    await page.keyboard.press('Escape');

    // papel personalizado descartável: cria e exclui pela própria UI
    await page.goto('/app/roles/new');
    const throwawayName = `Descartável ${suffix}`;
    await page.fill('#name', throwawayName);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/roles') && response.request().method() === 'POST'),
      page.locator('button:has-text("Criar papel")').click(),
    ]);
    await page.waitForURL(/\/app\/roles\/[0-9a-f-]+$/);
    await page.locator('button:has-text("Excluir papel")').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/roles/') && response.request().method() === 'DELETE'),
      dialog.getByRole('button', { name: 'Excluir', exact: true }).click(),
    ]);
    await page.waitForURL('**/app/roles');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/roles?') && response.url().includes('search=')),
      page.getByRole('searchbox', { name: 'Nome do papel' }).fill(throwawayName),
    ]);
    await expect(page.getByRole('row', { name: new RegExp(throwawayName) })).toHaveCount(0);
  });
});
