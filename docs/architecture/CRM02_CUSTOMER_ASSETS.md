# CRM-02 — Equipamentos do cliente

CRM-02 adiciona `customer_assets` e `customer_asset_identifiers` ao VetorOS 2.
Cada equipamento é vinculado a um cliente do mesmo tenant; o tenant e o contexto
operacional são derivados da sessão autenticada. As tabelas usam RLS obrigatório,
FKs compostas para impedir vínculos entre tenants e não possuem DELETE físico.

As permissões são `customer_assets.read`, `customer_assets.create` e
`customer_assets.update`. Alterações de cadastro, identificadores e status geram
eventos de auditoria append-only. A API expõe listagem, consulta, criação,
atualização, equipamentos por cliente e identificadores adicionais. A interface
possui as rotas `/app/assets`, `/app/assets/new` e `/app/assets/:id`.

Esta entrega prepara a futura OS-01, mas não implementa ordens de serviço nem
altera AUTH-01, migrations existentes ou módulos posteriores.
