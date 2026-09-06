import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthService, AuthSession } from '../auth/service.js';
import { requirePermission } from '../auth/service.js';

// ADM-03 — ver executed.md "Descoberta". A tabela real é `audit_events` (não `audit_logs`, que o
// correio.md assumia) — já append-only (trigger + grants sem UPDATE/DELETE, migration 0000), já
// RLS tenant-scoped, e já com o índice `(tenant_id, created_at DESC)` que a consulta principal
// desta rodada precisa (ver migration 0021 para o `EXPLAIN`). Este arquivo é só leitura: nenhum
// `INSERT`/`UPDATE`/`DELETE` é emitido por nenhuma rota daqui, e consultar a auditoria não gera
// um novo evento de auditoria (seção 19 do correio.md).
//
// "Módulo" não é um conceito do banco — é só um agrupamento de `resource_type` feito no
// frontend (`apps/web/lib/audit-labels.ts`) para exibição/filtro; a API só entende
// `resourceType` (um valor técnico, ou uma lista separada por vírgula), mantendo a API genérica
// e a tradução pt-BR inteiramente do lado do cliente — mesmo padrão de `permission-labels.ts`
// (ADM-01/02): o backend nunca traduz para o usuário, só devolve dado técnico consistente.

// Seção 12 do correio.md: nenhuma chamada a `auditResource` em nenhum módulo grava senha, hash,
// token, cookie ou credencial hoje (conferido por busca em todo `apps/api/src` — ver
// executed.md, Descoberta #8) e o `metadata` gravado é sempre pequeno (nomes de campo, códigos
// de permission, ids, números). Mesmo assim, esta função existe como uma garantia de verdade —
// não só "hoje não tem" — para qualquer `metadata` gravado no passado ou no futuro por um
// caminho que eu não tenha revisado: remove recursivamente qualquer chave cujo nome combine com
// um padrão sensível antes de qualquer resposta sair da API, sem alterar o registro histórico
// em si (a sanitização acontece só na leitura, nunca escreve de volta no banco).
const sensitiveKeyPattern = /password|senha|hash|token|secret|segredo|cookie|credential|credencial/i;
function sanitizeMetadata(value: unknown): unknown {
  // `jsonb` normalmente chega já desserializado (o driver conhece o OID pela coluna) — mas uma
  // linha inserida fora do caminho usual do drizzle (ex.: SQL cru de teste/migração) pode
  // devolver a coluna como texto puro em vez de objeto; tentar o parse antes de sanitizar evita
  // que um `metadata` assim escape sem passar pela checagem de chave sensível.
  const parsed = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return value; } })() : value;
  if (Array.isArray(parsed)) return parsed.map(sanitizeMetadata);
  if (parsed && typeof parsed === 'object') {
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, v]) => [key, sensitiveKeyPattern.test(key) ? '[removido]' : sanitizeMetadata(v)]));
  }
  return parsed;
}

const idSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  period: z.enum(['today', '7d', '30d', 'custom']).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  resourceType: z.string().trim().min(1).max(300).optional(),
  resourceId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
}).strict();

// Entidades "de cadastro" simples e estáveis (seção 13 do correio.md: preferir isso a "dezenas
// de joins polimórficos frágeis") — cada uma resolve um rótulo amigável com um único LEFT JOIN
// direto, condicionado a `resource_type`; o restante (service_order, quote, sale, purchase_*,
// inventory_part, stock_movement — entidades transacionais, sem um "nome" único e estável) cai
// no fallback tipo+identificador abreviado, que a própria seção 13 autoriza explicitamente.
const entityLabelExpr = sql`coalesce(
  case when e.resource_type='customer' then (select coalesce(nullif(trade_name,''),legal_name) from customers where tenant_id=e.tenant_id and id=e.resource_id) end,
  case when e.resource_type='customer_asset' then (select internal_identifier from customer_assets where tenant_id=e.tenant_id and id=e.resource_id) end,
  case when e.resource_type='supplier' then (select coalesce(nullif(trade_name,''),legal_name) from suppliers where tenant_id=e.tenant_id and id=e.resource_id) end,
  case when e.resource_type='company' then (select coalesce(nullif(trade_name,''),legal_name) from companies where tenant_id=e.tenant_id and id=e.resource_id) end,
  case when e.resource_type='branch' then (select name from branches where tenant_id=e.tenant_id and id=e.resource_id) end,
  case when e.resource_type='tenant_user_profile' then (select name from tenant_user_profiles where tenant_id=e.tenant_id and id=e.resource_id) end,
  case when e.resource_type='tenant_role' then (select name from tenant_roles where tenant_id=e.tenant_id and id=e.resource_id) end
)`;
const entityLabelSelect = sql`${entityLabelExpr} as entity_label`;

export function registerAuditRoutes(app: FastifyInstance, service: AuthService) {
  async function authenticated(request: FastifyRequest, reply: FastifyReply): Promise<AuthSession | undefined> {
    const session = await service.session(request.cookies.vetoros_session);
    if (!session) { reply.code(401).send({ error: 'unauthorized' }); return; }
    if (!session.activeTenantId) { reply.code(409).send({ error: 'tenant_required' }); return; }
    return session;
  }
  async function authorize(reply: FastifyReply, session: AuthSession) {
    try { await requirePermission(service, session, 'audit.read', { requireTenant: true }); return true; }
    catch { reply.code(403).send({ error: 'forbidden' }); return false; }
  }

  async function withActors<T extends { actor_identity_id: string | null }>(rows: T[]) {
    const ids = [...new Set(rows.map((row) => row.actor_identity_id).filter((id): id is string => id !== null))];
    const identities = await service.identitiesByIds(ids);
    const byId = new Map(identities.map((identity) => [identity.id, identity]));
    return rows.map((row) => ({ ...row, actorIdentity: row.actor_identity_id ? byId.get(row.actor_identity_id) : undefined }));
  }

  app.get('/audit-events', async (request, reply) => {
    const query = listSchema.safeParse(request.query); if (!query.success) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session)) return;
    const { page, pageSize, period, from, to, action, resourceType, resourceId, q } = query.data;
    const offset = (page - 1) * pageSize;

    // "hoje" respeita o fuso padrão do produto (branches.timezone default 'America/Sao_Paulo' —
    // não existe outro fuso de referência estabelecido em nenhum lugar do sistema hoje, e o
    // request não carrega o fuso do navegador do cliente); 7/30 dias são intervalos relativos a
    // `now()`, absolutos por natureza, sem ambiguidade de fuso.
    let periodCondition = sql`true`;
    if (period === 'today') periodCondition = sql`e.created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`;
    else if (period === '7d') periodCondition = sql`e.created_at >= now() - interval '7 days'`;
    else if (period === '30d') periodCondition = sql`e.created_at >= now() - interval '30 days'`;
    else if (period === 'custom') {
      if (from) periodCondition = sql`${periodCondition} and e.created_at >= ${from}::timestamptz`;
      if (to) periodCondition = sql`${periodCondition} and e.created_at < (${to}::date + 1)`;
    }

    const resourceTypes = resourceType ? resourceType.split(',').map((value) => value.trim()).filter(Boolean) : [];
    const resourceTypeCondition = resourceTypes.length > 0 ? sql`e.resource_type in (${sql.join(resourceTypes.map((value) => sql`${value}`), sql`,`)})` : sql`true`;

    // busca textual + "ator": nome (join direto, mesma transação) e e-mail (identities vive na
    // conexão de auth, fora de RLS — mesmo padrão de resolução em lote do ADM-01/02, não um
    // segundo mecanismo de busca).
    const matchedIdentityIds = q ? await service.findIdentityIdsByEmailPrefix(`${q.toLowerCase()}%`) : [];
    const actorEmailMatch = matchedIdentityIds.length > 0 ? sql`e.actor_identity_id in (${sql.join(matchedIdentityIds.map((id) => sql`${id}::uuid`), sql`,`)})` : sql`false`;
    // além de ação/tipo/id/ator, a busca também compara com o mesmo rótulo de entidade exibido
    // na coluna "Entidade" (a forma mais natural de alguém procurar "o que aconteceu com o
    // cliente X") — reaproveita a mesma expressão do SELECT, não inventa uma segunda lógica.
    const qCondition = q ? sql`(e.action ilike ${`%${q}%`} or e.resource_type ilike ${`%${q}%`} or e.resource_id::text ilike ${`${q}%`} or p.name ilike ${`%${q}%`} or ${entityLabelExpr} ilike ${`%${q}%`} or ${actorEmailMatch})` : sql`true`;

    const rows = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{
      id: string; created_at: Date; action: string; resource_type: string; resource_id: string | null;
      actor_identity_id: string | null; actor_name: string | null; entity_label: string | null; total: number;
    }>(sql`
      select e.id,e.created_at,e.action,e.resource_type,e.resource_id,e.actor_identity_id,p.name as actor_name,${entityLabelSelect},count(*) over()::int as total
      from audit_events e
      left join tenant_user_profiles p on p.tenant_id=e.tenant_id and p.id=e.effective_user_profile_id
      where (${periodCondition}) and (${resourceTypeCondition})
        and (${action ?? null}::text is null or e.action=${action ?? null})
        and (${resourceId ?? null}::uuid is null or e.resource_id=${resourceId ?? null})
        and (${qCondition})
      order by e.created_at desc, e.id desc
      limit ${pageSize} offset ${offset}`));

    const merged = await withActors(rows);
    return {
      items: merged.map((row) => ({
        id: row.id, createdAt: row.created_at, action: row.action, resourceType: row.resource_type, resourceId: row.resource_id,
        entityLabel: row.entity_label,
        actor: row.actor_identity_id ? { identityId: row.actor_identity_id, name: row.actor_name, email: row.actorIdentity?.emailNormalized ?? null } : null,
      })),
      page, pageSize, total: Number(rows[0]?.total ?? 0),
    };
  });

  app.get('/audit-events/:id', async (request, reply) => {
    const params = idSchema.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    const session = await authenticated(request, reply); if (!session) return;
    if (!await authorize(reply, session)) return;
    const [row] = await service.withAuthenticatedTenant(session, (tx) => tx.execute<{
      id: string; created_at: Date; action: string; resource_type: string; resource_id: string | null;
      actor_identity_id: string | null; actor_name: string | null; entity_label: string | null; metadata: Record<string, unknown>;
    }>(sql`
      select e.id,e.created_at,e.action,e.resource_type,e.resource_id,e.actor_identity_id,p.name as actor_name,${entityLabelSelect},e.metadata
      from audit_events e
      left join tenant_user_profiles p on p.tenant_id=e.tenant_id and p.id=e.effective_user_profile_id
      where e.id=${params.data.id}`));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const [identity] = row.actor_identity_id ? await service.identitiesByIds([row.actor_identity_id]) : [];
    return {
      id: row.id, createdAt: row.created_at, action: row.action, resourceType: row.resource_type, resourceId: row.resource_id,
      entityLabel: row.entity_label, metadata: sanitizeMetadata(row.metadata),
      actor: row.actor_identity_id ? { identityId: row.actor_identity_id, name: row.actor_name, email: identity?.emailNormalized ?? null } : null,
    };
  });
}
