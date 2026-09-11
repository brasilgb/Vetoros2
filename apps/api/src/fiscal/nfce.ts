import { createHash } from 'node:crypto';

export type NfceItem = { description: string; quantity: number; unitPrice: number; ncm: string; cfop: string; unit: string; taxXml: string };
export type NfceSale = { uf: string; cnpj: string; issuedAt: Date; series: number; number: number; emissionType: 1 | 9; numericCode: string; issuerName: string; stateRegistration: string; items: NfceItem[]; total: number; paymentDescription: string; paymentAmount: number };

const digits = (value: string) => value.replace(/\D/g, '');
const pad = (value: string | number, size: number) => String(value).padStart(size, '0');

export function accessKeyCheckDigit(base: string): number {
  if (!/^\d{43}$/.test(base)) throw new Error('nfce_access_key_base_invalid');
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i -= 1) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
}

export function buildNfceAccessKey(input: Pick<NfceSale, 'uf' | 'cnpj' | 'issuedAt' | 'series' | 'number' | 'emissionType' | 'numericCode'>): string {
  const uf = digits(input.uf);
  const cnpj = digits(input.cnpj);
  const numericCode = digits(input.numericCode);
  if (uf.length !== 2 || cnpj.length !== 14 || numericCode.length !== 8) throw new Error('nfce_access_key_fields_invalid');
  const aamm = `${input.issuedAt.getFullYear()}`.slice(-2) + pad(input.issuedAt.getMonth() + 1, 2);
  const base = `${pad(uf, 2)}${aamm}${cnpj}65${pad(input.series, 3)}${pad(input.number, 9)}${input.emissionType}${numericCode}`;
  return `${base}${accessKeyCheckDigit(base)}`;
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const money = (value: number) => value.toFixed(2);

export function buildNfceXml(sale: NfceSale): string {
  if (!sale.items.length) throw new Error('nfce_sale_without_items');
  for (const item of sale.items) {
    if (!/^\d{8}$/.test(item.ncm) || !/^\d{4}$/.test(item.cfop) || !item.taxXml.trim()) throw new Error(`nfce_item_tax_data_missing:${item.description}`);
  }
  const key = buildNfceAccessKey(sale);
  const items = sale.items.map((item, index) => `<det nItem="${index + 1}"><prod><cProd>${index + 1}</cProd><xProd>${escapeXml(item.description)}</xProd><NCM>${item.ncm}</NCM><CFOP>${item.cfop}</CFOP><uCom>${escapeXml(item.unit)}</uCom><qCom>${item.quantity.toFixed(3)}</qCom><vUnCom>${money(item.unitPrice)}</vUnCom><vProd>${money(item.quantity * item.unitPrice)}</vProd></prod><imposto>${item.taxXml}</imposto></det>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${key}" versao="4.00"><ide><cUF>${digits(sale.uf)}</cUF><natOp>VENDA</natOp><mod>65</mod><serie>${sale.series}</serie><nNF>${sale.number}</nNF><dhEmi>${sale.issuedAt.toISOString()}</dhEmi><tpNF>1</tpNF><idDest>1</idDest><tpImp>4</tpImp><tpEmis>${sale.emissionType}</tpEmis><cDV>${key.at(-1)}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>VetorOS</verProc></ide><emit><CNPJ>${digits(sale.cnpj)}</CNPJ><xNome>${escapeXml(sale.issuerName)}</xNome><IE>${escapeXml(sale.stateRegistration)}</IE><CRT>1</CRT></emit>${items}<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vProd>${money(sale.total)}</vProd><vNF>${money(sale.total)}</vNF></ICMSTot></total><pag><detPag><tPag>01</tPag><xPag>${escapeXml(sale.paymentDescription)}</xPag><vPag>${money(sale.paymentAmount)}</vPag></detPag></pag></infNFe></NFe>`;
}

export function buildNfceQrCodeUrl(baseUrl: string, accessKey: string, environment: 1 | 2, cscId: string, csc: string): string {
  if (!/^\d{44}$/.test(accessKey) || !cscId || !csc) throw new Error('nfce_qr_code_fields_invalid');
  const query = `chNFe=${accessKey}&nVersao=100`;
  const hash = createHash('sha1').update(`${query}${csc}`).digest('hex');
  return `${baseUrl.replace(/\/$/, '')}?p=${accessKey}|${environment}|${cscId}|${hash}`;
}

export function parseSefazResponse(xml: string): { statusCode: string | null; statusMessage: string | null; protocol: string | null; accessKey: string | null } {
  const read = (tag: string) => xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`))?.[1] ?? null;
  return { statusCode: read('cStat'), statusMessage: read('xMotivo'), protocol: read('nProt'), accessKey: read('chNFe') };
}

export function renderDanfeNfceHtml(input: { issuerName: string; cnpj: string; stateRegistration: string; series: number; number: number; issuedAt: Date; accessKey: string; protocol: string | null; qrCodeUrl: string; items: Array<Pick<NfceItem, 'description' | 'quantity' | 'unitPrice'>>; total: number; paymentDescription: string; environment: 'homologacao' | 'producao' }): string {
  const rows = input.items.map((item) => `<tr><td>${escapeXml(item.description)}</td><td>${item.quantity}</td><td>R$ ${money(item.quantity * item.unitPrice)}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE NFC-e ${input.number}</title><style>@page{size:80mm auto;margin:3mm}body{width:74mm;font:11px monospace;margin:auto}h1,h2,p{margin:3px 0;text-align:center}table{width:100%;border-collapse:collapse}td{padding:2px 0;border-bottom:1px dotted #777}td:nth-child(n+2){text-align:right}.key{font-size:9px;word-break:break-all}img{display:block;width:42mm;height:42mm;margin:4mm auto}.hom{font-weight:bold}</style></head><body><h1>${escapeXml(input.issuerName)}</h1><p>CNPJ ${digits(input.cnpj)} · IE ${escapeXml(input.stateRegistration)}</p>${input.environment === 'homologacao' ? '<p class="hom">DOCUMENTO EMITIDO EM HOMOLOGAÇÃO</p>' : ''}<h2>NFC-e — modelo 65</h2><p>Série ${input.series} · Nº ${input.number}</p><table><tbody>${rows}</tbody></table><p><strong>TOTAL R$ ${money(input.total)}</strong></p><p>Pagamento: ${escapeXml(input.paymentDescription)}</p><p>${input.issuedAt.toLocaleString('pt-BR')}</p><p class="key">${input.accessKey}</p>${input.protocol ? `<p>Protocolo: ${escapeXml(input.protocol)}</p>` : ''}<img alt="QR Code NFC-e" src="${escapeXml(input.qrCodeUrl)}"><script>window.print()</script></body></html>`;
}
