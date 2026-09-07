# REL-02 — Descoberta da exportação CSV

Data: 2026-09-07

## Estado anterior

- `GET /reports/summary` aceita somente `from` e `to` como datas ISO e usa
  intervalo semiaberto `[from,to)`.
- O retorno contém `period`, agregados de OS, vendas e clientes, distribuição de
  OS por status e movimentos de estoque por tipo.
- A rota exige sessão, contexto operacional completo e `reports.read`; tenant é
  protegido por RLS e empresa/filial são derivados exclusivamente da sessão.
- `/app/reports` é um Client Component que carrega o resumo pela API.
- Não há contrato compartilhado específico de Reports, biblioteca CSV ou
  convenção anterior de download HTTP no monorepo.

## Decisão

A consulta será extraída para uma única função interna usada pelo JSON e por
`GET /reports/export.csv`. O CSV será uma representação tabular determinística
dos mesmos agregados, sem novas métricas. Não haverá streaming, fila ou limite
de linhas porque o conjunto exportado é agregado e possui cardinalidade fixa
pequena (mais os enums finitos de status/tipo), não registros detalhados.

O formato será UTF-8 com BOM, cabeçalho explícito e células escapadas segundo
CSV. Valores textuais iniciados por `=`, `+`, `-` ou `@` receberão apóstrofo para
impedir formula injection; atualmente os labels exportados são controlados pelo
servidor, mas a proteção permanece na fronteira de serialização.
