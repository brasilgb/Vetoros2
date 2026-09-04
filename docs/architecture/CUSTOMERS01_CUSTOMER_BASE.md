# CUSTOMERS-01 — cadastro base de clientes

## Decisões

`customers` pertence ao tenant e não a uma filial. `origin_company_id` e `origin_branch_id` registram apenas a origem operacional validada; não particionam o cadastro nem impedem atendimento por outra filial autorizada. A API deriva o tenant da sessão e executa toda consulta em `TenantContext`; nenhuma entrada aceita `tenant_id`.

Os scopes AUTH-01 permanecem o único mecanismo de autorização. A operação usa o contexto operacional ativo (Branch, Company ou tenant) para avaliar `customers.read`, `customers.create` ou `customers.update`. Após autorizada, acessa o catálogo compartilhado do tenant sob RLS.

## Número comercial

`customer_number_counters` mantém uma linha por tenant. A criação executa `INSERT ... ON CONFLICT DO UPDATE SET last_number=last_number+1 RETURNING last_number` dentro da mesma transação do cliente. O bloqueio de linha do PostgreSQL serializa concorrentes; rollback não publica cliente nem avanço do contador. `(tenant_id, customer_number)` é único e o UUID continua sendo a PK.

## Documentos e endereços

CPF/CNPJ são validados e persistidos somente com dígitos. Um índice único parcial impede repetição por tenant quando há documento; `NULL` continua permitido e o mesmo documento pode existir em tenants distintos. Não há deduplicação por nome ou telefone.

Endereços ficam em `customer_addresses` desde a primeira versão. A API mantém um endereço primário, enquanto a tabela já permite futuros tipos e múltiplos registros sem reestruturar `customers`.

## Busca e auditoria

A busca usa prefixos indexáveis para nomes, documento, contatos, e-mail e número, evitando aplicar `%termo%` em todas as colunas. Eventos `customer.created`, `customer.updated` e `customer.status_changed` são append-only e contêm ator, perfil efetivo, ID e metadados mínimos, sem documento, contatos, e-mail ou observações.

Exclusão, regras fiscais, orçamento, OS, financeiro e atendimento permanecem fora desta fase.
