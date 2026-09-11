-- FIS-NFCE-01: configuração específica do estabelecimento e snapshots NFC-e.
-- Conteúdo sensível deve ser cifrado pela aplicação antes de ser persistido.
alter table branches add column if not exists nfce_uf char(2);
alter table branches add column if not exists nfce_series integer;
alter table branches add column if not exists nfce_next_number bigint not null default 1;
alter table branches add column if not exists nfce_csc_id text;
alter table branches add column if not exists nfce_csc_ciphertext text;
alter table branches add column if not exists nfce_certificate_ciphertext text;
alter table branches add column if not exists nfce_certificate_expires_at timestamptz;
alter table branches add column if not exists nfce_certificate_fingerprint text;
alter table branches add constraint branches_nfce_uf_ck check (nfce_uf is null or nfce_uf ~ '^[A-Z]{2}$');
alter table branches add constraint branches_nfce_series_ck check (nfce_series is null or nfce_series between 1 and 999);
alter table branches add constraint branches_nfce_next_number_ck check (nfce_next_number > 0 and nfce_next_number <= 999999999);

alter table fiscal_documents add column if not exists model smallint;
alter table fiscal_documents add column if not exists xml text;
alter table fiscal_documents add column if not exists authorized_xml text;
alter table fiscal_documents add column if not exists authorization_protocol text;
alter table fiscal_documents add column if not exists authorization_datetime timestamptz;
alter table fiscal_documents add column if not exists sefaz_status_code text;
alter table fiscal_documents add column if not exists sefaz_status_message text;
alter table fiscal_documents add column if not exists qr_code_url text;
alter table fiscal_documents add constraint fiscal_documents_nfce_model_ck check (model is null or model = 65);
create unique index fiscal_documents_nfce_number_uq on fiscal_documents(tenant_id,branch_id,series,document_number)
  where model = 65 and series is not null and document_number is not null;

insert into permissions(id,code,module,description) values
  ('01992ea1-1250-7000-8000-000000000069','fiscal.nfce.configure','fiscal','fiscal.nfce.configure'),
  ('01992ea1-1250-7000-8000-000000000070','fiscal.nfce.print','fiscal','fiscal.nfce.print')
on conflict (code) do nothing;
