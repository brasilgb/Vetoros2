import { test, expect, login, selectContextFromHeader } from './fixtures';

// Seção 20 do correio.md ADM-01. Dados únicos por execução (timestamp), sem depender de ordem
// entre specs — cada teste cria seus próprios usuários descartáveis, exceto o de "último
// administrador", que usa deliberadamente o próprio usuário logado (o seed torna o login de E2E
// o administrador do tenant Alpha) porque essa é a única forma de testar esse cenário sem
// depender de contagens de outras suítes rodando em paralelo.
const suffix = Date.now().toString(36);

test.describe('ADM-01 — administração de usuários', () => {
  test('administrador acessa Usuários e a listagem carrega', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await page.getByRole('link', { name: 'Usuários' }).click();
    await page.waitForURL('**/app/users');
    await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('cria usuário escolhendo o papel por nome (sem UUID manual) e abre o detalhe', async ({ page }) => {
    await login(page);
    await page.goto('/app/users/new');

    // não existe nenhum campo pedindo um UUID de papel — só um <select> com nomes em pt-BR
    await expect(page.getByText('roleId')).toHaveCount(0);
    const roleSelect = page.locator('#roleId');
    await expect(roleSelect.locator('option', { hasText: 'Atendente' })).toHaveCount(1);

    const name = `E2E Criar ${suffix}`;
    const email = `e2e-criar-${suffix}@example.test`;
    await page.fill('#name', name);
    await page.fill('#email', email);
    await roleSelect.selectOption({ label: 'Atendente' });
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/users') && response.request().method() === 'POST'),
      page.locator('button:has-text("Criar usuário")').click(),
    ]);

    // e-mail novo => a API gera senha temporária e a tela para para mostrá-la antes de navegar
    await expect(page.getByRole('heading', { name: 'Usuário criado' })).toBeVisible();
    const password = await page.locator('code').textContent();
    expect(password?.length ?? 0).toBeGreaterThanOrEqual(8);
    await page.locator('button:has-text("Já anotei")').click();
    await page.waitForURL(/\/app\/users\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  test('altera o papel do usuário e a mudança persiste após recarregar', async ({ page }) => {
    await login(page);
    await page.goto('/app/users/new');
    const name = `E2E Papel ${suffix}`;
    await page.fill('#name', name);
    await page.fill('#email', `e2e-papel-${suffix}@example.test`);
    await page.locator('#roleId').selectOption({ label: 'Atendente' });
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/users') && response.request().method() === 'POST'),
      page.locator('button:has-text("Criar usuário")').click(),
    ]);
    await page.locator('button:has-text("Já anotei")').click();
    await page.waitForURL(/\/app\/users\/[0-9a-f-]+$/);

    const roleSelect = page.locator('#roleId');
    await roleSelect.selectOption({ label: 'Técnico' });
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/users/') && response.request().method() === 'PATCH'),
      page.locator('button:has-text("Salvar papel")').click(),
    ]);
    await expect(roleSelect).toHaveValue(await roleSelect.locator('option', { hasText: 'Técnico' }).getAttribute('value') ?? '');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#roleId')).toHaveValue(await roleSelect.locator('option', { hasText: 'Técnico' }).getAttribute('value') ?? '');
  });

  test('inativar: cancelar não tem efeito; confirmar aplica a ação', async ({ page }) => {
    await login(page);
    await page.goto('/app/users/new');
    const name = `E2E Inativar ${suffix}`;
    await page.fill('#name', name);
    await page.fill('#email', `e2e-inativar-${suffix}@example.test`);
    await page.locator('#roleId').selectOption({ label: 'Atendente' });
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/users') && response.request().method() === 'POST'),
      page.locator('button:has-text("Criar usuário")').click(),
    ]);
    await page.locator('button:has-text("Já anotei")').click();
    await page.waitForURL(/\/app\/users\/[0-9a-f-]+$/);

    await page.locator('button:has-text("Inativar")').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Ativo', { exact: true })).toBeVisible();

    await page.locator('button:has-text("Inativar")').first().click();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/users/') && response.request().method() === 'PATCH'),
      dialog.getByRole('button', { name: 'Inativar', exact: true }).click(),
    ]);
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Inativo', { exact: true })).toBeVisible();
  });

  test('último administrador: tentar remover a própria função administrativa é recusado com mensagem compreensível', async ({ page }) => {
    await login(page);
    await page.goto('/app');
    await selectContextFromHeader(page);
    await page.goto('/app/users');
    // busca pelo próprio nome seedado do login de E2E — a listagem pode ter outros usuários com
    // papel Administrador (criados por outras suítes/execuções), então não basta filtrar por
    // papel: precisa ser especificamente a linha do usuário logado.
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/users?') && response.url().includes('search=')),
      page.getByRole('searchbox', { name: 'Nome ou e-mail' }).fill('Anderson Brasil (faker)'),
    ]);
    const row = page.getByRole('row', { name: /Anderson Brasil \(faker\)/ });
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(/\/app\/users\/[0-9a-f-]+$/);
    await expect(page.getByText('Ativo', { exact: true })).toBeVisible();

    await page.locator('button:has-text("Inativar")').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/users/') && response.request().method() === 'PATCH'),
      dialog.getByRole('button', { name: 'Inativar', exact: true }).click(),
    ]);
    // a API recusa (409) e a tela mostra uma mensagem compreensível dentro do próprio diálogo,
    // sem código técnico — e o diálogo continua aberto (nada de "sucesso silencioso")
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/administrador ativo/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText('Ativo', { exact: true })).toBeVisible();
  });
});
