# Roadmap canônico — VetorOS2

Este documento define a sequência canônica dos marcos. `DONE` identifica escopo já entregue; não reabre ou redefine decisões históricas.

| Status | Marco | Nome |
| --- | --- | --- |
| DONE | DB-01 | Multitenancy |
| DONE | AUTH-01 | Autenticação, sessão e contexto de tenant |
| DONE | CORE-01 | Company / Branch e contexto operacional |
| DONE | CRM-01 | Clientes |
| DONE | CRM-02 | Equipamentos do cliente |
| DONE | CRM-03 | Orçamentos |
| DONE | OS-01 | Ordens de Serviço |
| DONE | OS-02 | Itens e Serviços da Ordem |
| DONE | EST-01 | Estoque de Peças e Movimentações |
| DONE | EST-02 | Reserva, Consumo e Devolução pela OS |
| DONE | COM-01 | Fornecedores |
| DONE | COM-02 | Pedidos de Compra |
| DONE | COM-03 | Recebimentos de Compra |
| DONE | COM-04 | Devoluções de Compra |
| DONE | ADM-01 | Usuários |
| DONE | ADM-02 | Papéis e Permissions |
| DONE | ADM-03 | Auditoria |
| DONE | UX-01 a UX-03 | Experiência operacional |
| DONE | FIN-01 | Caixa e Recebimentos |
| DONE | FIN-02 | Contas a Receber |
| DONE | FIN-03 | Contas a Pagar |
| DONE | FIN-04 | Contas Financeiras, Tesouraria e Estornos/Correções Financeiras |
| DONE | CAI-01 | Caixa Operacional: Abertura, Movimentações e Fechamento (coberto pelo FIN-01 existente) |
| DONE | CAI-02 | Operação e Controle Avançado de Caixa |
| DONE | CAI-03 | Fechamento Gerencial e Conciliação Operacional de Caixa |
| DONE | CAI-04 | Relatório e Comprovante de Fechamento de Caixa |
| DONE | CAI-05 | Auditoria e Histórico Operacional de Caixa |
| DONE | VEN-01 | Vendas |
| DONE | VEN-02 | Baixa de Estoque pela Venda |
| DONE | VEN-03 | Cancelamento de Venda com Estorno de Estoque |
| DONE | VEN-03.1 | Fechamento RBAC de `sales.cancel` |
| DONE | AGD-01 | Agendamentos Operacionais vinculados à Ordem de Serviço |
| DONE | REL-01 | Relatórios Operacionais Essenciais |
| DONE | REL-02 | Exportação CSV de Relatórios |
| DONE | QA-01 | Isolamento e paralelismo determinístico das suítes de integração |
| DONE | PRD-01 | Production Readiness & Operational Hardening |
| DONE | CAD-01 | Cadastros Fundamentais |
| DONE | OS-ADV-01 | Ordem de Serviço Operacional Completa e Retorno em Garantia |
| DONE | OS-ADV-02 | Ordem de Serviço Operacional Completa (máquina de estados, cancelamento dedicado e UI) |
| DONE | COM-ADV-01 | Compras Operacionais Completas (auditoria confirmou COM-01/04 já maduros; RBAC negativa e UI de recebimentos fechadas) |
| DONE | FIN-ADV-01 | Financeiro Operacional Completo (auditoria confirmou FIN/CAI/VEN já maduros; concorrência em payables e navegação de origem fechadas) |
| DONE | VEN-ADV-01 | Vendas Operacionais Completas (auditoria confirmou VEN-01/03.1 já maduros; navegação de origem venda→financeiro fechada) |
| DONE | PDV-ADV-01 | Frente de Caixa Operacional Completa (`/app/pos` sobre o domínio de `sales` existente; `POST /sales/:id/checkout` orquestra confirmação+pagamento atomicamente) |

PRD-01 foi concluído. Não há próximo marco autorizado neste documento.

Nota de release: o gate de código, banco e API do CAD-01 foi concluído. O smoke Web/E2E não pôde ser executado neste ambiente por restrições externas confirmadas de Chromium e Docker socket e deverá ser repetido em ambiente compatível antes de release/produção.

QA-WEB-SMOKE — validar smoke Web dos CRUDs CAD-01 em ambiente com Chromium e Docker disponíveis antes do release. Esta é uma pendência de validação operacional, não de implementação.
