# AUTH-01 — Autenticação, sessão e seleção de tenant

## Fluxo

`Identity → opaque Session → TenantMembership → TenantContext → explicit Permission`.

O login normaliza o e-mail, busca a identidade global pela conexão `vetoros_auth`, sempre executa Argon2id (inclusive para identidade inexistente) e retorna a mesma falha para usuário desconhecido, senha errada ou identidade bloqueada. Um token aleatório de 256 bits é entregue somente no cookie; o banco armazena seu SHA-256.

Sessões são server-side, expiram, podem ser revogadas e não carregam roles/permissions no cookie. O cookie é `HttpOnly`, `SameSite=Strict`, `Path=/`, tem `Max-Age` e usa `Secure` quando `COOKIE_SECURE=true`. Login é limitado a cinco tentativas por minuto. CORS aceita credenciais somente da `WEB_ORIGIN` configurada.

## Seleção e contexto

Uma membership válida exige membership ativa/não expirada, perfil ativo e tenant ativo/trial. Uma única opção é selecionada automaticamente; várias exigem `POST /auth/select-tenant`. O backend ignora qualquer autoridade alegada pelo cliente e persiste na sessão apenas IDs novamente validados.

`withAuthenticatedTenant` deriva `tenant_id`, ator real e perfil efetivo exclusivamente da sessão persistida e chama `withTenantTransaction`. Nenhum endpoint aceita esses valores do frontend.

## Autorização

`hasPermission`/`requirePermission` centralizam a resolução por `access_grants → tenant_roles → tenant_role_permissions → permissions`, considerando status e vigência. A estrutura está pronta para filtros company/branch; controllers não comparam nomes de roles.

## Boundary global

`vetoros_auth` é uma role dedicada, não superuser e sem `BYPASSRLS`. Ela possui acesso mínimo à identidade e sessão globais. Para listar memberships, instala `app.actor_identity_id` localmente em uma transação; policies RLS específicas permitem somente memberships/perfis daquela identidade. Ela não recebe DML de domínio. `vetoros_runtime` permanece tenant-owned e inalterada.

## Auditoria e revogação

Login com tenant automático, seleção/troca e logout geram eventos append-only no tenant ativo sem senha, hash, cookie ou token. Logout marca a sessão como revogada e limpa o cookie; sessões expiradas/revogadas são recusadas.

## Riscos residuais

- Em produção, TLS e `COOKIE_SECURE=true` são obrigatórios.
- Rate limiting distribuído deve migrar do armazenamento em memória para Redis ao escalar a API horizontalmente.
- Recuperação de senha, MFA e rotação administrativa ficam para gates próprios.
