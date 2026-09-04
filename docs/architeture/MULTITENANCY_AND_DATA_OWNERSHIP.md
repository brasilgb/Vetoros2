# VetorOS 2 — Multitenancy e ownership de dados

**Status:** proposta arquitetural anterior ao schema  
**Data:** 2 de setembro de 2026  
**Escopo:** definição de ownership, isolamento, autorização e integridade. Este documento não define migrations nem escolhe provider fiscal.

## 1. Visão geral

O VetorOS 2 deve adotar `tenant_id` como fronteira inviolável de segurança e `company_id`/`branch_id` como fronteiras de operação e autorização dentro do tenant.

```text
Tenant (conta SaaS e limite de segurança)
└── Empresa (pessoa jurídica/CNPJ e limite fiscal/contábil)
    └── Filial (unidade operacional, estoque, caixa e atendimento)
```

Decisão recomendada: banco compartilhado com schema compartilhado, todas as linhas de negócio contendo `tenant_id`, constraints compostas que impeçam relações cruzadas e PostgreSQL Row-Level Security (RLS) como segunda barreira. O backend continua responsável pela autorização; RLS não substitui policies.

Ownership possui dois significados distintos:

- **Proprietário de segurança:** sempre o Tenant para qualquer dado de cliente SaaS.
- **Proprietário de negócio:** Tenant, Empresa ou Filial conforme a matriz abaixo.

Mesmo entidades de Empresa ou Filial devem armazenar `tenant_id` diretamente. A redundância é deliberada: torna escopo, índices, RLS, auditoria e constraints explícitos sem joins para descobrir o tenant.

## 2. Hierarquia Tenant → Empresa → Filial

### Tenant

Representa contrato SaaS, identidade comercial da conta, plano, assinatura, limites globais e configurações compartilháveis. Não representa CNPJ emissor nem unidade operacional.

### Empresa

Representa uma entidade jurídica. CNPJ, inscrição, regime tributário, certificados, credenciais fiscais, séries, contas financeiras jurídicas e documentos fiscais pertencem à Empresa. Uma empresa não pode mudar de tenant; transferência exige processo administrativo excepcional e auditado.

### Filial

Representa a unidade operacional. OS, agenda, estoque físico, caixa e PDV pertencem à Filial. Uma filial pertence exatamente a uma Empresa e herda o mesmo Tenant. Deve ser possível uma Empresa possuir somente uma filial padrão, sem tratamento especial no domínio.

### Invariantes hierárquicos

- `companies (tenant_id, id)` é chave candidata para relações compostas.
- `branches (tenant_id, company_id, id)` identifica unidade e impede associar filial a empresa externa.
- Registros de filial armazenam os três IDs quando a empresa for necessária ao domínio; `company_id` não é inferido silenciosamente em mutações.
- IDs fornecidos pelo cliente são referências não confiáveis. O backend resolve todos dentro do contexto autenticado.
- Alterar `company_id` ou `branch_id` de documento operacional lançado não é edição comum; requer transferência de domínio validada, geralmente proibida após efeitos financeiros/fiscais.

## 3. Princípios de isolamento

1. Toda request, job, evento e comando opera com `TenantContext` obrigatório e imutável.
2. O contexto nasce de sessão/token validado, nunca de `tenant_id` livre no body/query.
3. Repositories tenant-owned exigem contexto no construtor ou assinatura; não existe método operacional sem escopo.
4. Toda tabela tenant-owned possui `tenant_id NOT NULL` e RLS por `current_setting('app.tenant_id')` (ou mecanismo equivalente da conexão).
5. A transação instala tenant e usuário na conexão; pool devolve a conexão somente após limpar o contexto.
6. FKs compostas garantem que relações pertençam ao mesmo tenant e, quando aplicável, à mesma empresa/filial.
7. Cache, object storage, filas, locks, idempotency keys e métricas usam prefixo de tenant; empresa/filial entram quando o recurso for local.
8. A autorização é deny-by-default e feita no backend por ação e escopo.
9. Rotas públicas usam capability token opaco, rotacionável, expirável, com rate limit; nunca desativam o escopo tenant da entidade resolvida.
10. A plataforma/control plane usa identidade e conexão separadas, com acesso administrativo temporário, justificado e auditado.

## 4. Matriz de ownership dos módulos

Legenda: T = Tenant, E = Empresa, F = Filial, `—` = não se aplica, `opt.` = opcional conforme uso. “Compartilha” significa visibilidade autorizável dentro do mesmo tenant, nunca entre tenants.

| Domínio/entidade | Dono | `tenant_id` | `company_id` | `branch_id` | Compartilhamento e autorização | Constraint/índice principal |
|---|---:|:---:|:---:|:---:|---|---|
| Tenant | T | próprio `id` | — | — | somente control plane e admins do tenant | slug/documento comercial únicos conforme política |
| Empresa | T | sim | próprio `id` | — | admins do tenant; acesso por membership | `UNIQUE(tenant_id,id)`, CNPJ único no tenant |
| Filial | E | sim | sim | próprio `id` | usuários vinculados; admin pode abranger empresas | FK composta para Empresa; código único por empresa |
| Usuário/identidade | T | sim | — | — | identidade única do tenant; escopos por memberships | e-mail normalizado conforme decisão de login |
| Roles/permissões | T + sistema | sim para custom | opt. | opt. | grants por tenant/empresa/filial; templates do sistema imutáveis | unicidade de role por tenant/nome/escopo |
| Cliente mestre (`party`) | T | sim | — | — | compartilhável apenas por política e grant | índice em documento normalizado; não impor dedupe cego |
| Relação empresa-cliente | E | sim | sim | opt. | dados comerciais/consentimentos separados | `UNIQUE(tenant_id,company_id,party_id)` |
| Contato/endereço | T ou relação | sim | opt. | opt. | pessoal no mestre; uso/snapshots por relação/documento | FKs compostas e tipo/validade |
| Equipamento | T | sim | opt. | opt. | pertence ao cliente; vínculo operacional registra filial | serial indexado, sem unicidade universal cega |
| Marca/modelo/categoria | T | sim | — | — | catálogo compartilhável; override local se necessário | nomes normalizados por tenant |
| Técnico | T | sim | — | — | perfil do usuário/colaborador; alocações por filial | membership ativa e datas de vigência |
| Fornecedor | T + relação E | sim | opt. | — | cadastro mestre; condição fiscal/comercial por empresa | documento + relação por empresa |
| Produto mestre/SKU | T | sim | — | — | catálogo compartilhável | SKU único por tenant; barcode com política explícita |
| Preço/custo | E/F | sim | sim | opt. | tabelas compartilháveis ou override de filial | vigência sem sobreposição por escopo |
| Tributação do produto/serviço | E | sim | sim | opt. | nunca compartilhar implicitamente entre CNPJs | classificação vigente por empresa/operação |
| Estoque/saldo | F | sim | sim | sim | nunca somado para autorização; consolidação só leitura | `UNIQUE(tenant_id,branch_id,sku_id,location_id)` |
| Movimento/transferência | F | sim | sim | sim | imutável; transferência gera duas pernas correlatas | idempotência + índice filial/SKU/data |
| Estoque em posse do técnico | F | sim | sim | sim | sublocal/custódia, não estoque sem dono | técnico alocado e ledger de custódia |
| Orçamento/itens/versões | F | sim | sim | sim | cliente pode aprovar por capability; acesso por filial | número único no escopo; versão imutável aprovada |
| Aprovação/reprovação | F | sim | sim | sim | evento imutável com ator/canal/evidência | idempotency key e uma decisão vigente |
| OS/itens | F | sim | sim | sim | usuários com grant da filial; consulta agregada autorizada | número único por filial ou empresa (decisão) |
| Checklist/diagnóstico/laudo | F | sim | sim | sim | parte do prontuário da OS; versões/snapshots | FK composta para OS e autor |
| Fotos/anexos | entidade pai | sim | opt. | opt. | herdam ACL do pai; storage prefixado e URL temporária | hash, tamanho, MIME e vínculo compostos |
| Agenda/visita externa | F | sim | sim | sim | filial responsável; técnico por alocação | índices filial/período/técnico/status |
| Venda/itens/PDV | F | sim | sim | sim | terminal/caixa da filial | número por filial; itens como snapshot |
| Caixa/sessão/lançamento | F | sim | sim | sim | operador autorizado na filial | um caixa aberto por terminal/escopo via índice parcial |
| Recebimento | E/F | sim | sim | sim | origem operacional em filial; contabilização na empresa | idempotência, origem e conta financeira |
| Forma de pagamento | T/E | sim | opt. | opt. | catálogo tenant com habilitação/conta por empresa/filial | código único e vigência |
| Conta a pagar/receber | E | sim | sim | opt. | pertence à pessoa jurídica; centro/filial opcional obrigatório por política | índices vencimento/status/empresa |
| Comissão | E/F | sim | sim | sim | regra empresarial; fato deriva de operação na filial | versão da regra + beneficiário + origem única |
| Despesa | E/F | sim | sim | opt. | obrigação da empresa, alocação em filial/centro | documento/origem e competência |
| Conta bancária/financeira | E | sim | sim | opt. | segregada por CNPJ; filial apenas escopo operacional | dados sensíveis criptografados |
| NF-e/NFC-e/NFS-e | E + F emissora | sim | sim | sim | fiscal por empresa; estabelecimento emissor definido | chave fiscal única, série/número/modelo |
| Certificado digital | E | sim | sim | — | somente serviço fiscal e admins específicos | segredo criptografado, fingerprint/validade |
| Série fiscal | E/F | sim | sim | opt. | conforme estabelecimento/modelo fiscal | `UNIQUE(tenant_id,company_id,branch_scope,model,series)` |
| Configuração tributária | E | sim | sim | opt. | parâmetros por CNPJ, overrides explícitos | vigência e ausência de sobreposição |
| Mensagem interna | T/F | sim | opt. | opt. | audiência definida; ACL de remetente/destinatário | tenant + participantes; retenção |
| WhatsApp/notificação | T/E/F | sim | opt. | opt. | canal e remetente podem ser locais | destinatário, consentimento, status, idempotência |
| Template | T com override E/F | sim | opt. | opt. | resolução explícita: F → E → T → sistema | uma versão ativa por tipo/escopo |
| Auditoria/log de domínio | mesmo do alvo | sim | opt. | opt. | append-only; suporte não altera | tenant/data/aggregate/actor/correlation |
| Configuração | T/E/F | sim | opt. | opt. | chave declara escopo permitido e herança | `UNIQUE(tenant_id,scope_type,scope_id,key)` |
| Integração/API key/webhook | T/E/F | sim | opt. | opt. | menor escopo necessário; segredo nunca retornado | hash/fingerprint, rotação e scopes |
| Plano/feature comercial | plataforma | — | — | — | control plane; tenant recebe entitlement | versão e vigência |
| Assinatura/limite/uso | T | sim | — | — | faturamento do SaaS; empresas consomem quota do tenant | período + métrica + tenant únicos |

## 5. Modelo de usuários e permissões

### Modelo recomendado

- `users`: identidade pertencente ao Tenant.
- `roles`: papéis do sistema e papéis customizados do Tenant.
- `permissions`: catálogo estável de capacidades, como `orders.read`, `cash.close` e `fiscal.transmit`.
- `role_permissions`: composição do papel.
- `access_grants`: liga usuário + papel + escopo (`tenant`, `company` ou `branch`) com vigência.
- `branch_memberships`: vínculo operacional opcional (lotação, técnico, atendente), separado de autorização.

Um grant em Tenant pode alcançar descendentes apenas quando o papel declarar herança. Grant de Empresa alcança suas filiais; grant de Filial não alcança irmãs. Negação explícita tende a tornar o sistema complexo; recomenda-se não suportá-la inicialmente. O usuário do exemplo recebe três grants independentes.

Autorização efetiva:

```text
permitir = usuário ativo
        AND tenant da sessão = tenant do recurso
        AND existe grant vigente para a ação
        AND escopo do grant contém o recurso
        AND condições de domínio são satisfeitas
```

Policies do backend consultam uma projeção/cache de grants; alterações invalidam cache imediatamente. Frontend recebe capacidades apenas para adaptar UX. Service accounts, suporte e integrações não usam papéis humanos.

Para evitar complexidade: começar com papéis predefinidos (owner, administrador, atendimento, técnico, estoque, caixa, financeiro, fiscal, leitura) e grants hierárquicos; permitir papel customizado somente se houver demanda comprovada.

## 6. Estratégia de clientes

Recomendação: cadastro mestre de pessoa (`parties`) no Tenant, com relações por Empresa (`company_customers`). Isso evita duplicar CPF/CNPJ e permite isolamento comercial.

- `parties`: nome/documento normalizado e dados básicos compartilháveis.
- `party_contacts`/`party_addresses`: dados canônicos com consentimento e proveniência.
- `company_customers`: código do cliente, status, limite, condição de pagamento, vendedor, observações privadas, consentimentos e preferências daquela Empresa.
- `branch_customer_context`: somente se surgirem atributos realmente locais; não duplicar o cliente para guardar histórico.
- OS, venda, orçamento e fiscal armazenam `party_id`, `company_customer_id` e snapshots necessários. Histórico pertence à empresa/filial da transação e não se torna visível automaticamente às demais.

A pesquisa de duplicidade sugere correspondências por documento/contato, mas não mescla automaticamente. CPF/CNPJ não deve ter unicidade absoluta: estrangeiros, registros provisórios, documentos ausentes e dados legados exigem exceções. Quando válido e verificado, um índice parcial pode garantir unicidade por Tenant e tipo.

Compartilhamento entre empresas é uma permissão explícita (`customer.directory.read`) distinta de acesso ao histórico. Uma empresa pode usar o mestre e criar sua própria relação sem ler preços, notas ou atendimentos de outra.

## 7. Estratégia de produtos

Separar:

- `products`: identidade comercial mestre do Tenant.
- `skus`: unidade estocável, código, barcode, unidade e variantes.
- `company_product_profiles`: habilitação, descrição fiscal e classificação por Empresa.
- `price_tables`/`price_entries`: preço com moeda, vigência e escopo Empresa/Filial.
- `cost_layers` ou custo calculado: por Filial; custo não é atributo universal do produto.
- `tax_profiles`: por Empresa, tipo de operação e vigência.

Serviços podem compartilhar catálogo no Tenant, mas preço, tributação, disponibilidade e código fiscal pertencem à Empresa/Filial. Itens de orçamento, OS, venda e documento fiscal são snapshots: mudanças posteriores no catálogo não reescrevem documentos históricos.

## 8. Estratégia de estoque

Estoque é obrigatoriamente separado por Filial e modelado como ledger, não como simples contador editável.

- Cada movimento é imutável, com quantidade assinada, origem, usuário, instante e idempotency key.
- Saldo é projeção do ledger (`stock_balances`) atualizada na mesma transação ou reconstruível.
- Reserva de orçamento/OS é separada do saldo físico; disponibilidade = físico − reservado.
- Consumo por OS/venda, retorno, ajuste, inventário e transferência são tipos explícitos.
- Transferência entre filiais cria saída e entrada correlatas; pode ter estado em trânsito.
- Material com técnico é uma localização/custódia vinculada à filial de origem. Troca de lotação não transfere saldo implicitamente.
- Nenhuma operação permite saldo negativo, exceto se uma política tenant explícita autorizar; mesmo assim deve auditar.

Lock por `(tenant_id, branch_id, sku_id, location_id)` ou atualização atômica com versão evita overselling. Índices atendem SKU/filial, origem, data e itens abaixo do mínimo.

## 9. Modelo Orçamento → OS

Orçamento é agregado independente e versionado.

```text
Draft → Sent → Approved | Rejected | Expired | Cancelled
                       Approved → create Work Order (opcional, idempotente)
Direct Work Order → sem orçamento de origem
```

Invariantes:

- Orçamento pertence a uma Filial, Empresa, Cliente e moeda.
- Uma versão enviada congela itens, preços, impostos, prazos e termos; edição cria nova versão.
- Aprovação registra versão exata, ator, canal, timestamp, IP/evidência e token usado.
- Apenas versão enviada e vigente pode ser aprovada/reprovada; decisão repetida é idempotente.
- Criar OS a partir do orçamento copia snapshots e referencia `source_quote_id/source_quote_version_id`.
- Por padrão um orçamento gera no máximo uma OS; divisão em várias OS é futura e exige decisão explícita.
- OS direta é permitida com `source_quote_id NULL` e motivo/canal opcional.
- OS e orçamento devem permanecer na mesma Empresa/Filial; transferência posterior requer cancelamento/reemissão, não troca de FK.
- Aprovação não baixa estoque; pode reservar conforme política. Baixa ocorre no consumo/saída definido pela operação.

## 10. Impactos financeiros

Financeiro é juridicamente da Empresa, com atribuição operacional à Filial. Caixa físico/PDV é da Filial; conta bancária, recebível e obrigação são da Empresa.

- Todo lançamento financeiro possui origem idempotente e ledger imutável; correção ocorre por estorno.
- Recebimentos podem liquidar um ou vários títulos; pagamento parcial permanece suportado.
- Fechamento de caixa congela composição e impede exclusão/alteração retroativa; ajustes posteriores são novos lançamentos.
- Formas de pagamento do Tenant são habilitadas por Empresa/Filial e mapeadas a contas/taxas.
- Comissão grava versão da regra aplicada e snapshot da base, evitando recálculo histórico silencioso.
- Consolidação multiempresa é relatório autorizado; não mistura livros ou saldos.
- Valores usam `numeric`, moeda explícita e arredondamento definido por domínio; nunca `float`.

## 11. Impactos fiscais

O agregado fiscal pertence à Empresa e ao estabelecimento emissor (Filial). Deve conter configuração fiscal versionada, certificado/credencial, séries, documento, itens, eventos, protocolo, XML/PDF e trilha de transmissão.

```ts
interface FiscalProvider {
  issue(command: IssueFiscalDocument): Promise<ProviderReceipt>;
  query(command: QueryFiscalDocument): Promise<FiscalStatus>;
  cancel(command: CancelFiscalDocument): Promise<ProviderReceipt>;
  correct?(command: CorrectionLetter): Promise<ProviderReceipt>;
}
```

O domínio usa tipos próprios; adapters traduzem para APIs oficiais ou terceiros. Provider não decide tributação, autorização do usuário, numeração interna ou ownership.

Requisitos:

- Credenciais e certificados criptografados por envelope/KMS, com acesso somente ao worker fiscal.
- Série/número/modelo protegidos por constraint e alocação concorrente; rejeições não permitem reutilização indevida.
- Idempotency key por comando; webhooks assinados, anti-replay e reconciliados por consulta ativa.
- Documento autorizado e eventos são imutáveis; cancelamento/correção são novos eventos.
- Dados transmitidos e respostas têm retenção legal, hash e acesso auditado.
- NF-e/NFC-e/NFS-e compartilham abstrações, mas preservam diferenças legais. Regras definitivas dependem de contador e legislação vigente.

## 12. Estratégia de numeração

Não usar `MAX(numero) + 1`. Usar tabela `number_sequences` com linha bloqueada atomicamente (`UPDATE ... SET next_value = next_value + 1 RETURNING`) dentro da transação ou sequences PostgreSQL quando lacunas forem aceitáveis.

| Número | Escopo recomendado | Observação |
|---|---|---|
| Cliente | Empresa | código comercial; `party.id` é UUID/ULID técnico |
| Orçamento | Filial | opção por Empresa ainda aberta; prefixo visual pode incluir filial |
| OS | Filial | preserva operação local; unicidade composta |
| Venda/PDV | Filial | relacionada a caixa/terminal |
| Recibo interno | Empresa + série/Filial | definir requisito legal/operacional |
| Movimento financeiro | Empresa | identificador contábil; filial como dimensão |
| Movimento de estoque | Filial | ledger técnico pode usar UUID + número exibível |
| Documento interno | conforme agregado | declarar `sequence_scope` |
| Documento fiscal | Empresa/estabelecimento + modelo + série | seguir legislação; separado da numeração interna |

Lacunas devem ser aceitas para números operacionais concorrentes. Se o negócio exigir ausência de lacunas, alocar no evento de confirmação, sem prometer perfeição após rollback/falha distribuída. Toda sequência tem `tenant_id`, `scope_type`, `scope_id`, `document_type`, `series`, `next_value` e `version`, com unicidade composta.

## 13. Constraints e integridade

- PKs técnicas UUIDv7/ULID ou bigint são decisão de implementação; números humanos nunca são PK/FK.
- `tenant_id`, `company_id` e `branch_id` são `NOT NULL` quando o domínio os exige.
- FKs compostas repetem tenant: uma OS referencia cliente, filial e orçamento dentro do mesmo tenant/empresa.
- Checks validam valores não negativos, intervalos, estados conhecidos e coerência de datas.
- Uniques incluem escopo: números, SKU, série fiscal, configurações e idempotency keys.
- Índices parciais impõem “um aberto/ativo” onde aplicável: caixa por terminal, versão vigente, grant ativo.
- Exclusão física de entidade com histórico financeiro, fiscal, estoque ou auditoria é proibida; usar estado/inativação.
- Dados pessoais podem ser pseudonimizados conforme política sem destruir documentos de retenção obrigatória.
- Relações polimórficas genéricas devem ser evitadas em invariantes críticas; preferir FKs explícitas ou tabelas por evento.

Exemplo conceitual de barreira cruzada, não schema definitivo:

```text
orders(tenant_id, company_id, branch_id, customer_relation_id)
  FK (tenant_id, company_id, branch_id) → branches(...)
  FK (tenant_id, company_id, customer_relation_id) → company_customers(...)
```

## 14. Índices

Todo índice operacional inicia por `tenant_id`; em telas locais, segue por `branch_id` ou `company_id`. O desenho final deve usar queries e `EXPLAIN`, não uma indexação automática de todas as FKs.

Padrões mínimos:

- listagens: `(tenant_id, branch_id, status, created_at DESC)`;
- busca por número: uniques no escopo + índice para documento normalizado;
- agenda: `(tenant_id, branch_id, starts_at)` e `(tenant_id, technician_id, starts_at)`;
- estoque: `(tenant_id, branch_id, sku_id, location_id)`;
- financeiro: `(tenant_id, company_id, status, due_at)`;
- auditoria: `(tenant_id, aggregate_type, aggregate_id, occurred_at)` e por ator/data;
- jobs/outbox: `(status, available_at)` com tenant no payload/índice de diagnóstico;
- fiscal: chave de acesso global única quando aplicável e `(tenant_id, company_id, model, series, number)`;
- documentos normalizados: índices parciais para valores verificados/não nulos.

RLS deve ser testada com planos de execução. Particionamento só após volume medido; candidatos futuros são auditoria, outbox, notificações e documentos fiscais por data.

## 15. Auditoria

Auditoria é append-only e separada de logs técnicos. Cada evento contém: tenant, empresa/filial quando aplicável, ator humano/service account, papel/grant efetivo, ação, agregado, versão, antes/depois redigidos, request/correlation/idempotency IDs, IP/device/canal, timestamp UTC e motivo.

Auditar obrigatoriamente: login e impersonation; grants; troca de escopo; cliente/consentimento; orçamento/aprovação; status de OS; estoque; caixa; financeiro; comissão; fiscal; certificados/API keys; exportações e acesso administrativo.

Secrets, senhas, tokens, certificados, dados completos de cartão e payloads desnecessários nunca entram no log. A retenção varia por categoria e obrigação legal. Exportação/auditoria multiempresa exige permissão própria.

## 16. Riscos arquiteturais

| Risco | Severidade | Tratamento |
|---|---|---|
| Query sem tenant ou conexão com contexto residual | Crítica | repository obrigatório + RLS + testes de pool |
| FK válida porém cruzando tenant/empresa | Crítica | FKs compostas e validação de use case |
| Grant herdado excessivamente | Alta | deny-by-default, visualização de acesso efetivo e testes matriciais |
| Compartilhar cliente expor histórico | Alta | mestre separado de relação/histórico e permissões distintas |
| Saldo duplicado em transferência | Crítica | ledger de duas pernas, idempotência e reconciliação |
| Numeração concorrente | Alta | contador atômico; nunca `MAX+1` |
| Dual write durante migração | Alta | ownership único por agregado, outbox e reconciliação |
| Configuração fiscal errada/herdada | Crítica | sem herança implícita entre empresas; vigência e homologação |
| Secrets em logs/storage | Crítica | KMS/envelope, redaction e acesso do worker |
| Documento histórico mudar com cadastro | Alta | snapshots versionados |
| Cache/arquivo sem namespace | Alta | chaves/prefixos obrigatórios e testes cross-tenant |
| Relatórios consolidados burlarem ACL | Alta | query policy própria e escopo máximo autorizado |

## 17. Decisões recomendadas

1. Tenant como limite de segurança; Empresa como limite jurídico/fiscal; Filial como limite operacional.
2. `tenant_id` direto em toda tabela de negócio, mesmo quando derivável.
3. PostgreSQL RLS + FKs compostas + repositories contextuais como defesa em profundidade.
4. Usuário no Tenant, com grants de papel em Tenant/Empresa/Filial e herança descendente explícita.
5. Cliente e fornecedor mestres no Tenant, relações privadas por Empresa e histórico sempre no escopo da transação.
6. Catálogo mestre no Tenant; preço/tributação por Empresa ou Filial; estoque exclusivamente por Filial.
7. Ledger imutável para estoque/financeiro e snapshots para documentos.
8. Orçamento independente, versionado, podendo gerar OS; OS direta continua válida.
9. Fiscal nativo no domínio, transmissão por `FiscalProvider`, sem vendor no modelo central.
10. Contadores atômicos por escopo, com lacunas aceitas em numeração operacional.
11. UUID/ULID/bigint técnico separado do número humano.
12. Controle administrativo global isolado do data plane dos tenants.

## 18. Pontos que ainda precisam de decisão do proprietário do produto

1. O mesmo login pode participar de tenants diferentes ou cada identidade pertence estritamente a um Tenant?
2. Empresas do mesmo Tenant veem por padrão o diretório mestre de clientes ou precisam de opt-in por Empresa?
3. CPF/CNPJ verificado deve ser único no Tenant, apenas sugerir duplicidade ou permitir duplicatas justificadas?
4. Histórico resumido de cliente/equipamento pode ser compartilhado entre empresas? Quais campos?
5. Numeração de orçamento e OS é por Filial ou por Empresa? Há números atuais que precisam permanecer?
6. Há caixa único por Filial, por terminal ou por operador/turno?
7. Estoque negativo será proibido sem exceção? Como tratar migração de saldos legados inconsistentes?
8. Reserva de estoque acontece ao enviar, aprovar orçamento, abrir OS ou somente ao separar material?
9. Um orçamento pode gerar várias OS ou várias filiais podem executar partes dele?
10. OS pode ser transferida entre filiais antes/depois de estoque, pagamento ou documento fiscal?
11. Quem é juridicamente o credor de recebíveis originados numa filial e como ocorre consolidação?
12. Comissões são definidas por Empresa, Filial, serviço/produto ou técnico? Qual é o evento de aquisição/estorno?
13. Quais overrides de configuração podem descer de Tenant para Empresa/Filial e quais nunca podem herdar?
14. Quais modelos fiscais serão prioritários por município/UF e quem homologa regras tributárias?
15. Certificado A1 será armazenado pelo VetorOS? Haverá HSM/KMS e política de rotação?
16. Qual retenção legal e política LGPD para anexos, localização GPS, mensagens, auditoria e documentos?
17. Suporte VetorOS poderá impersonar usuários? Com qual aprovação, prazo e visibilidade ao cliente?
18. Quais limites SaaS são bloqueantes e quais apenas geram alerta? Contam por Tenant, Empresa ou Filial?
19. Filial pode operar com fuso/moeda diferentes? A recomendação inicial é uma moeda por Empresa e timezone por Filial.
20. O catálogo pode ser restrito a determinadas empresas/filiais ou é sempre visível no Tenant?

Estas decisões devem ser encerradas antes do schema PostgreSQL. Cada resposta deve virar um ADR, constraint/policy e teste de isolamento correspondente.
