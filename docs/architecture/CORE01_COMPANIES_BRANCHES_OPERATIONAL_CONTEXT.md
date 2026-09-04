# CORE-01 — Companies, Branches e contexto operacional

## Modelo

Company continua tenant-owned e Branch pertence obrigatoriamente à combinação `(tenant_id, company_id)`. CRUD ocorre somente com sessão válida, `withAuthenticatedTenant`, permission explícita e RLS. Não há exclusão física.

## Scopes

A engine AUTH-01 foi estendida com alvo opcional company/branch:

- grant tenant alcança companies e branches do tenant;
- grant company alcança somente aquela company e suas branches;
- grant branch alcança somente aquela branch e não eleva acesso à company inteira.

Listagens usam o mesmo relacionamento de grants e retornam apenas recursos alcançáveis. Criação de Company exige grant tenant; criação de Branch exige alcance da Company. Status, vigência, role e permission são reavaliados no backend.

## TenantContext versus OperationalContext

TenantContext é fronteira de segurança obrigatória e instala tenant/ator/perfil na transação PostgreSQL. OperationalContext é a seleção revalidada de company/branch para navegação e operações; nunca altera o tenant nem substitui autorização.

Company/branch ativos são persistidos na sessão opaca. Toda seleção valida RLS, status, parentesco e scope antes da persistência. A sessão possui FKs compostas para impedir contexto inconsistente mesmo diante de bug na API.

## API e frontend

Endpoints de Company/Branch exigem backend authorization e registram create/update em auditoria append-only. `/auth/session` fornece identidade de UI, contexto ativo, capabilities e recursos acessíveis; capabilities servem apenas à apresentação.

O shell `/app` oferece seletores e páginas mínimas `/app/companies` e `/app/branches`, incluindo loading, vazio, negado e sessão expirada.

## Invariantes

- IDs de tenant/identidade/perfil nunca vêm do cliente.
- UUID conhecido de outro tenant permanece invisível por RLS.
- Branch não referencia Company de outro tenant.
- Membership suspensa e grant expirado perdem efeito imediatamente.
- Troca concorrente de contexto não torna objetos antigos de sessão válidos.
