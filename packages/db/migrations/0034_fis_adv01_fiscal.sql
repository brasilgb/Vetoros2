-- FIS-ADV-01: infraestrutura fiscal mínima real, apoiada nas entidades operacionais já
-- existentes. Descoberta (ver executed.md): não havia NENHUMA estrutura fiscal persistida —
-- só um role template `fiscal` vazio (seed inicial, migration 0001) e os campos de identidade
-- fiscal já cobertos por outros marcos (companies.tax_id_type/state_registration/
-- municipal_registration/tax_regime; customers.document_type/rg_state_registration/
-- municipal_registration + customer_addresses; inventory_parts.ncm; barcode_ean já serve como
-- GTIN). Esta migration só acrescenta o que realmente faltava.

-- 1. Identidade fiscal do emitente (seção 4). Decisão de domínio: a identidade fiscal (CNPJ/IE/
-- IM/regime) já pertence a `companies` (não duplicada aqui); o endereço/município que aparece
-- no documento fiscal é o da FILIAL emissora (`branches`), porque toda venda/OS já carrega
-- company_id E branch_id — é a filial que fisicamente realiza a operação. CNAE e ambiente fiscal
-- (homologação/produção) são atributos da empresa (mesmo CNPJ, mesmo CNAE em todas as filiais);
-- código IBGE do município é atributo da filial (endereço físico de cada uma).
alter table companies add column if not exists cnae text;
alter table companies add column if not exists fiscal_environment text not null default 'homologacao';
alter table companies add constraint companies_fiscal_environment_ck check (fiscal_environment in ('homologacao','producao'));
alter table companies add constraint companies_tax_regime_ck check (tax_regime is null or tax_regime in ('simples_nacional','simples_nacional_excesso','lucro_presumido','lucro_real','mei'));
alter table branches add column if not exists ibge_city_code char(7);
alter table branches add constraint branches_ibge_city_code_ck check (ibge_city_code is null or ibge_city_code ~ '^[0-9]{7}$');

-- 2. Dados cadastrais fiscais do produto (seção 6), separados da tributação efetivamente
-- aplicada num documento (que vive congelada em fiscal_document_items, nunca aqui). CFOP padrão
-- é só um valor de partida útil para a emissão preencher sozinha — nunca a fonte de verdade da
-- operação real, que depende do documento (venda interna/interestadual, devolução etc.) e é
-- decidida (ou sobrescrita) no momento de emitir.
alter table inventory_parts add column if not exists cest char(7);
alter table inventory_parts add column if not exists origin char(1);
alter table inventory_parts add column if not exists default_cfop char(4);
alter table inventory_parts add constraint inventory_parts_cest_ck check (cest is null or cest ~ '^[0-9]{7}$');
alter table inventory_parts add constraint inventory_parts_origin_ck check (origin is null or origin in ('0','1','2','3','4','5','6','7','8'));
alter table inventory_parts add constraint inventory_parts_default_cfop_ck check (default_cfop is null or default_cfop ~ '^[0-9]{4}$');

-- 3. Documento fiscal (seção 9/10). Origem inequívoca (venda XOR OS, nunca as duas, nunca
-- nenhuma) — mesmo padrão já usado por `receivables` (FIN-02). Numeração NÃO é controlada aqui
-- (seção 13): série/número são atribuídos pelo provedor fiscal na autorização: nascem `null` e
-- só são preenchidos quando a SEFAZ/prefeitura autoriza, exatamente o dado que a Focus NFe
-- devolve — não existe contador local, não haveria o que contar (o provedor é quem decide o
-- próximo número disponível daquela série).
create table fiscal_documents(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,company_id uuid not null,branch_id uuid not null,
 origin_sale_id uuid,origin_service_order_id uuid,
 document_type text not null,status text not null default 'draft',environment text not null,
 series text,document_number bigint,access_key char(44),protocol text,
 recipient_person_type text not null,recipient_document_type text,recipient_document text,
 recipient_legal_name text not null,recipient_email text,recipient_address jsonb,
 subtotal numeric(14,2) not null,discount_total numeric(14,2) not null default 0,total numeric(14,2) not null,
 xml_url text,pdf_url text,external_id text,rejection_reason text,
 idempotency_key text not null,
 requested_at timestamptz,authorized_at timestamptz,rejected_at timestamptz,cancellation_requested_at timestamptz,cancelled_at timestamptz,
 created_by_identity_id uuid references identities(id),updated_by_identity_id uuid references identities(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id),unique(tenant_id,idempotency_key),
 unique(tenant_id,document_type,series,document_number),
 check(document_type in('nfce','nfe','nfse')),
 check(status in('draft','pending','authorized','rejected','cancellation_pending','cancelled')),
 check(environment in('homologacao','producao')),
 check(recipient_person_type in('individual','company')),
 check((origin_sale_id is not null)::int + (origin_service_order_id is not null)::int = 1),
 check(subtotal>=0 and discount_total>=0 and total>=0),
 check(length(trim(idempotency_key))>=8),
 foreign key(tenant_id,company_id) references companies(tenant_id,id),
 foreign key(tenant_id,company_id,branch_id) references branches(tenant_id,company_id,id),
 foreign key(tenant_id,origin_sale_id) references sales(tenant_id,id),
 foreign key(tenant_id,origin_service_order_id) references service_orders(tenant_id,id)
);
create index fiscal_documents_list_idx on fiscal_documents(tenant_id,branch_id,created_at desc);
create index fiscal_documents_status_idx on fiscal_documents(tenant_id,status);
create index fiscal_documents_sale_idx on fiscal_documents(tenant_id,origin_sale_id) where origin_sale_id is not null;
create index fiscal_documents_service_order_idx on fiscal_documents(tenant_id,origin_service_order_id) where origin_service_order_id is not null;

create table fiscal_document_items(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,fiscal_document_id uuid not null,
 description text not null,quantity numeric(14,3) not null,unit_price numeric(14,2) not null,
 total numeric(14,2) generated always as (round(quantity*unit_price,2)) stored,
 ncm char(8),cest char(7),origin char(1),cfop char(4),tax_situation text,
 service_code text,iss_rate numeric(5,2),
 created_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,fiscal_document_id) references fiscal_documents(tenant_id,id) on delete cascade,
 check(quantity>0),check(unit_price>=0),check(iss_rate is null or (iss_rate>=0 and iss_rate<=100))
);
create index fiscal_document_items_document_idx on fiscal_document_items(tenant_id,fiscal_document_id);

-- 4. Estados fiscais (seção 11): máquina de estados explícita, mesmo padrão de trigger único
-- usado por OS-ADV-02 (migration 0033) — cobre qualquer via de escrita presente ou futura, não
-- só a rota que existe hoje. Autorizado é praticamente terminal (só sai para cancelamento,
-- iniciado por cancellation_pending); cancelado é terminal de verdade. Rejeitado pode voltar
-- para pending (nova tentativa de emissão) sem perder o rejection_reason anterior — o histórico
-- de tentativas fica no rastro de requested_at/rejected_at sendo sobrescritos apenas pela
-- tentativa mais recente, nunca apagando o documento em si.
create function enforce_fiscal_document_status_transition() returns trigger language plpgsql as $$
begin
  if not (
    (old.status='draft' and new.status in('pending','cancelled')) or
    (old.status='pending' and new.status in('authorized','rejected','cancelled')) or
    (old.status='rejected' and new.status in('pending','cancelled')) or
    (old.status='authorized' and new.status='cancellation_pending') or
    (old.status='cancellation_pending' and new.status in('authorized','cancelled'))
  ) then
    raise exception 'invalid fiscal document status transition: % -> %', old.status, new.status using errcode='55000';
  end if;
  return new;
end $$;
create trigger fiscal_documents_status_transition before update on fiscal_documents for each row
  when (new.status is distinct from old.status) execute function enforce_fiscal_document_status_transition();

-- 5. Imutabilidade após autorização (seção 12): nenhum dado fiscal relevante do documento ou de
-- seus itens pode ser reescrito depois de autorizado — é um snapshot histórico, não um registro
-- vivo. Cancelamento continua permitido (é uma transição de status, não uma edição de conteúdo).
create function reject_fiscal_document_content_mutation() returns trigger language plpgsql as $$
begin
  if old.status not in ('draft','rejected') then
    raise exception 'fiscal document content is immutable after issuance was requested' using errcode='55000';
  end if;
  return new;
end $$;
create trigger fiscal_documents_content_immutable before update on fiscal_documents for each row
  when (
    new.subtotal is distinct from old.subtotal or new.discount_total is distinct from old.discount_total or new.total is distinct from old.total
    or new.recipient_legal_name is distinct from old.recipient_legal_name or new.recipient_document is distinct from old.recipient_document
    or new.recipient_address is distinct from old.recipient_address or new.document_type is distinct from old.document_type
  ) execute function reject_fiscal_document_content_mutation();
create function reject_fiscal_document_item_mutation() returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from fiscal_documents where id=coalesce(new.fiscal_document_id,old.fiscal_document_id);
  if v_status not in ('draft','rejected') then raise exception 'fiscal document items are immutable after issuance was requested' using errcode='55000'; end if;
  return coalesce(new,old);
end $$;
create trigger fiscal_document_items_immutable before update or delete on fiscal_document_items for each row execute function reject_fiscal_document_item_mutation();

alter table fiscal_documents enable row level security;alter table fiscal_documents force row level security;
create policy fiscal_documents_tenant on fiscal_documents using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());
alter table fiscal_document_items enable row level security;alter table fiscal_document_items force row level security;
create policy fiscal_document_items_tenant on fiscal_document_items using(tenant_id=vetoros_current_tenant_id()) with check(tenant_id=vetoros_current_tenant_id());

grant select,insert,update on fiscal_documents to vetoros_runtime;
grant select,insert,update,delete on fiscal_document_items to vetoros_runtime;
revoke delete on fiscal_documents from vetoros_runtime;

-- 6. RBAC (seção 24): reaproveita o role template `fiscal` já reservado desde a migration 0001
-- (seed inicial), nunca populado até agora. Só 4 permissions, mesmo padrão semântico de
-- read/create + verbos de ação (`.issue`/`.cancel`, mesmo estilo de `.confirm`/`.approve`
-- alhures) — sem granularidade artificial (não existe `.update` porque o documento não é editável
-- por PATCH, só evolui por ação de domínio).
insert into permissions(id,code,module,description) values
  ('01992ea1-1250-7000-8000-000000000065','fiscal.read','fiscal','fiscal.read'),
  ('01992ea1-1250-7000-8000-000000000066','fiscal.create','fiscal','fiscal.create'),
  ('01992ea1-1250-7000-8000-000000000067','fiscal.issue','fiscal','fiscal.issue'),
  ('01992ea1-1250-7000-8000-000000000068','fiscal.cancel','fiscal','fiscal.cancel')
on conflict (code) do nothing;
