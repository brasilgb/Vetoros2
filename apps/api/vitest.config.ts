import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    maxWorkers: 4,
    // Os fixtures de integração usam deliberadamente o mesmo tenant seedado e
    // alteram usuários/grants/estoque entre arquivos. A execução concorrente
    // cria interferência real de estado; serializar arquivos é parte do contrato
    // do ambiente de integração, não uma alteração da regra de negócio.
    fileParallelism: false,
  },
});
