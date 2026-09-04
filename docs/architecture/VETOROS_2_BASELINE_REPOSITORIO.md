# VetorOS 2 — Baseline do repositório

Data: 3 de setembro de 2026.

## Estado encontrado

`vetoros2` continha apenas `correio.md` e sete documentos em `docs/architeture`. Não havia monorepo, package manager configurado, código Node, schema Drizzle, migration, autenticação, Docker ou testes. Assim, não havia regressões técnicas pré-existentes a registrar nem comandos de qualidade aplicáveis antes do bootstrap.

O diretório irmão `vetoros1` é o Laravel legado e foi consultado somente para confirmar a separação. Nenhum arquivo dele foi alterado.

## Ferramentas observadas

- Node.js: 24.18.0
- pnpm/Corepack: 11.17.0
- Docker/Compose: indisponível neste WSL durante o baseline
- PostgreSQL CLI/server: indisponível

As versões efetivas de dependências ficam registradas no `pnpm-lock.yaml` após a instalação. A arquitetura alvo é PostgreSQL 17.

## Divergência documental

Os documentos estavam em `docs/architeture` (grafia antiga). Eles foram preservados sem alteração como fontes normativas. A documentação nova usa o caminho aprovado `docs/architecture`.

## Gate inicial

O diretório vazio autorizava um bootstrap limpo. A ausência de Docker impede validar localmente migration e RLS reais até habilitar a integração do Docker Desktop no WSL.
