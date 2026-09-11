import { randomUUID } from 'node:crypto';
import type { FiscalCancelResult, FiscalIssuePayload, FiscalProvider, FiscalProviderResult } from './provider.js';

// FIS-ADV-01, seção 28: provedor determinístico usado exclusivamente pelos testes automatizados
// — nenhuma chamada de rede real, nenhum ambiente de homologação necessário para rodar a suíte.
// Comportamento por fila explícita (`enqueueIssueResult`/`enqueueCancelResult`): o teste decide
// exatamente o que a próxima chamada deve devolver (autorizado/rejeitado/pendente/erro), sem
// acoplar esse controle a nenhum dado de negócio (nome do cliente, referência etc.) — o
// `externalRef`/idempotency_key nasce inteiramente do servidor (seção 21), o teste não tem nem
// precisa ter acesso a ele para dirigir o fake.
export class FakeFiscalProvider implements FiscalProvider {
  private readonly issueQueue: FiscalProviderResult[] = [];
  private readonly cancelQueue: FiscalCancelResult[] = [];
  private readonly issued = new Map<string, { series: string; documentNumber: number; accessKey: string }>();
  private nextNumber = 1;
  public issueCalls = 0;
  public consultCalls = 0;
  public cancelCalls = 0;

  enqueueIssueResult(result: FiscalProviderResult) { this.issueQueue.push(result); }
  enqueueCancelResult(result: FiscalCancelResult) { this.cancelQueue.push(result); }

  async issue(payload: FiscalIssuePayload): Promise<FiscalProviderResult> {
    this.issueCalls += 1;
    const queued = this.issueQueue.shift();
    if (queued) return queued;
    const existing = this.issued.get(payload.externalRef);
    if (existing) return { outcome: 'authorized', externalId: payload.externalRef, series: existing.series, documentNumber: existing.documentNumber, accessKey: existing.accessKey, protocol: `PROTO-${payload.externalRef}` };
    const documentNumber = this.nextNumber++;
    const record = { series: '1', documentNumber, accessKey: randomUUID().replaceAll('-', '').padEnd(44, '0').slice(0, 44) };
    this.issued.set(payload.externalRef, record);
    return { outcome: 'authorized', externalId: payload.externalRef, series: record.series, documentNumber: record.documentNumber, accessKey: record.accessKey, protocol: `PROTO-${payload.externalRef}` };
  }

  async consult(externalId: string): Promise<FiscalProviderResult> {
    this.consultCalls += 1;
    const queued = this.issueQueue.shift();
    if (queued) return queued;
    const existing = this.issued.get(externalId);
    if (existing) return { outcome: 'authorized', externalId, series: existing.series, documentNumber: existing.documentNumber, accessKey: existing.accessKey, protocol: `PROTO-${externalId}` };
    return { outcome: 'pending', externalId };
  }

  async cancel(): Promise<FiscalCancelResult> {
    this.cancelCalls += 1;
    const queued = this.cancelQueue.shift();
    if (queued) return queued;
    return { outcome: 'cancelled', protocol: `CANCEL-${randomUUID()}` };
  }
}
