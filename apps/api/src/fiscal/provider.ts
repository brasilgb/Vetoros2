// FIS-ADV-01, seção 14: abstração mínima de provedor fiscal — o domínio (rotas, máquina de
// estados, snapshots, idempotência) nunca fala com a Focus NFe diretamente, só com esta
// interface. Isso é o que a seção 14 pede ("impedir que regras de negócio fiquem espalhadas
// pelo código") e o que permite `FakeFiscalProvider` substituir a Focus NFe nos testes (seção
// 28: nenhum teste automatizado faz uma chamada de rede real).
export type FiscalDocumentType = 'nfce' | 'nfe' | 'nfse';

export type FiscalAddress = { postalCode: string | null; street: string; number: string | null; complement: string | null; district: string | null; city: string; state: string | null; country: string; ibgeCityCode: string | null };

export type FiscalIssuePayload = {
  environment: 'homologacao' | 'producao';
  documentType: FiscalDocumentType;
  externalRef: string;
  issuer: { cnpj: string; stateRegistration: string | null; municipalRegistration: string | null; legalName: string; tradeName: string | null; cnae: string | null; taxRegime: string | null; address: FiscalAddress };
  recipient: { personType: 'individual' | 'company'; document: string | null; documentType: string | null; legalName: string; email: string | null; address: FiscalAddress | null };
  items: Array<{ description: string; quantity: number; unitPrice: number; ncm: string | null; cest: string | null; origin: string | null; cfop: string | null; taxSituation: string | null; serviceCode: string | null; issRate: number | null }>;
  totals: { subtotal: number; discountTotal: number; total: number };
};

// Estados possíveis de uma chamada ao provedor (seção 20): `authorized`/`rejected` são
// definitivos; `pending` significa "o provedor recebeu mas ainda não decidiu" (segue
// consultável por `externalId`); `error` é falha de transporte/indisponibilidade — nunca deve
// ser interpretado como "não emitido", só como "não sabemos ainda", exatamente a distinção que a
// seção 20 exige ("nunca assumir que timeout significa nota não emitida").
export type FiscalProviderResult =
  | { outcome: 'authorized'; externalId: string; series?: string | undefined; documentNumber?: number | undefined; accessKey?: string | undefined; protocol?: string | undefined; xmlUrl?: string | undefined; pdfUrl?: string | undefined }
  | { outcome: 'rejected'; externalId?: string | undefined; reason: string }
  | { outcome: 'pending'; externalId?: string | undefined }
  | { outcome: 'error'; message: string };

export type FiscalCancelResult = { outcome: 'cancelled'; protocol?: string | undefined } | { outcome: 'rejected'; reason: string } | { outcome: 'pending' } | { outcome: 'error'; message: string };

export interface FiscalProvider {
  issue(payload: FiscalIssuePayload): Promise<FiscalProviderResult>;
  consult(externalId: string, documentType: FiscalDocumentType): Promise<FiscalProviderResult>;
  cancel(externalId: string, documentType: FiscalDocumentType, reason: string): Promise<FiscalCancelResult>;
}

const pathFor = (type: FiscalDocumentType) => (type === 'nfce' ? 'nfce' : type === 'nfe' ? 'nfe' : 'nfse');

// Adapter estrutural para a Focus NFe (seção 14): autenticação HTTP Basic com o token como
// usuário e senha em branco, e `ref` como referência idempotente por documento — isso é o
// contrato público e estável da Focus NFe, não um detalhe inventado. O mapeamento exato de
// payload/campos de resposta abaixo é o ponto de integração; como não há credencial de
// homologação disponível neste ambiente para validar contra a API real (seção 28), ele deve ser
// conferido contra a documentação/sandbox da Focus NFe antes do primeiro uso em produção — não é
// apresentado como testado ponta a ponta contra o provedor real, só como estruturalmente correto
// e isolado atrás de `FiscalProvider` (trocável sem tocar nas rotas/domínio).
export class FocusNfeProvider implements FiscalProvider {
  constructor(private readonly apiKey: string | undefined, private readonly baseUrl = 'https://api.focusnfe.com.br') {}

  private authHeader(): string {
    // Nunca logado, nunca devolvido em resposta de API (seção 15) — só usado aqui, dentro do
    // próprio adapter, para montar o header de uma chamada de saída.
    return `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`;
  }

  async issue(payload: FiscalIssuePayload): Promise<FiscalProviderResult> {
    if (!this.apiKey) return { outcome: 'error', message: 'fiscal_provider_not_configured' };
    try {
      const response = await fetch(`${this.baseUrl}/v2/${pathFor(payload.documentType)}?ref=${encodeURIComponent(payload.externalRef)}`, {
        method: 'POST',
        headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}) as Record<string, unknown>);
      if (response.status === 200 || response.status === 201) {
        if (body.status === 'autorizado') return { outcome: 'authorized', externalId: payload.externalRef, series: body.serie as string | undefined, documentNumber: body.numero as number | undefined, accessKey: body.chave_nfe as string | undefined, protocol: body.protocolo_autorizacao as string | undefined, xmlUrl: body.caminho_xml_nota_fiscal as string | undefined, pdfUrl: (body.caminho_danfe ?? body.caminho_danfse) as string | undefined };
        if (body.status === 'erro_autorizacao' || body.status === 'rejeitado') return { outcome: 'rejected', externalId: payload.externalRef, reason: (body.mensagem_sefaz as string) ?? 'rejected_by_provider' };
        return { outcome: 'pending', externalId: payload.externalRef };
      }
      if (response.status === 429 || response.status >= 500) return { outcome: 'error', message: `fiscal_provider_unavailable_${response.status}` };
      return { outcome: 'rejected', externalId: payload.externalRef, reason: (body.mensagem as string) ?? `provider_error_${response.status}` };
    } catch {
      return { outcome: 'error', message: 'fiscal_provider_unreachable' };
    }
  }

  async consult(externalId: string, documentType: FiscalDocumentType): Promise<FiscalProviderResult> {
    if (!this.apiKey) return { outcome: 'error', message: 'fiscal_provider_not_configured' };
    try {
      const response = await fetch(`${this.baseUrl}/v2/${pathFor(documentType)}/${encodeURIComponent(externalId)}`, { headers: { Authorization: this.authHeader() } });
      const body = await response.json().catch(() => ({}) as Record<string, unknown>);
      if (!response.ok) return { outcome: 'error', message: `fiscal_provider_unavailable_${response.status}` };
      if (body.status === 'autorizado') return { outcome: 'authorized', externalId, series: body.serie as string | undefined, documentNumber: body.numero as number | undefined, accessKey: body.chave_nfe as string | undefined, protocol: body.protocolo_autorizacao as string | undefined, xmlUrl: body.caminho_xml_nota_fiscal as string | undefined, pdfUrl: (body.caminho_danfe ?? body.caminho_danfse) as string | undefined };
      if (body.status === 'erro_autorizacao' || body.status === 'rejeitado') return { outcome: 'rejected', externalId, reason: (body.mensagem_sefaz as string) ?? 'rejected_by_provider' };
      return { outcome: 'pending', externalId };
    } catch {
      return { outcome: 'error', message: 'fiscal_provider_unreachable' };
    }
  }

  async cancel(externalId: string, documentType: FiscalDocumentType, reason: string): Promise<FiscalCancelResult> {
    if (!this.apiKey) return { outcome: 'error', message: 'fiscal_provider_not_configured' };
    try {
      const response = await fetch(`${this.baseUrl}/v2/${pathFor(documentType)}/${encodeURIComponent(externalId)}`, {
        method: 'DELETE',
        headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa: reason }),
      });
      const body = await response.json().catch(() => ({}) as Record<string, unknown>);
      if (response.status === 200 || response.status === 201) {
        if (body.status === 'cancelado') return { outcome: 'cancelled', protocol: body.protocolo_cancelamento as string | undefined };
        return { outcome: 'pending' };
      }
      if (response.status === 429 || response.status >= 500) return { outcome: 'error', message: `fiscal_provider_unavailable_${response.status}` };
      return { outcome: 'rejected', reason: (body.mensagem as string) ?? `provider_error_${response.status}` };
    } catch {
      return { outcome: 'error', message: 'fiscal_provider_unreachable' };
    }
  }
}
