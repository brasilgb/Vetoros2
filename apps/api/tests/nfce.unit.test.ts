import { describe, expect, it } from 'vitest';
import { accessKeyCheckDigit, buildNfceAccessKey, buildNfceQrCodeUrl, buildNfceXml, parseSefazResponse, renderDanfeNfceHtml } from '../src/fiscal/nfce.js';

const base = { uf: '35', cnpj: '12345678000195', issuedAt: new Date('2026-09-11T12:00:00.000Z'), series: 1, number: 42, emissionType: 1 as const, numericCode: '12345678' };
const item = { description: 'Produto & teste', quantity: 2, unitPrice: 10, ncm: '12345678', cfop: '5102', unit: 'UN', taxXml: '<ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>20.00</vBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS></ICMS00></ICMS>' };

describe('FIS-NFCE-01 pure NFC-e components', () => {
  it('calculates a 44-digit access key and deterministic check digit', () => {
    const key = buildNfceAccessKey(base);
    expect(key).toHaveLength(44);
    expect(accessKeyCheckDigit(key.slice(0, -1))).toBe(Number(key.at(-1)));
    expect(buildNfceAccessKey(base)).toBe(key);
  });

  it('does not invent tax data when generating XML', () => {
    expect(() => buildNfceXml({ ...base, issuerName: 'Loja & Cia', stateRegistration: '123', items: [{ ...item, taxXml: '' }], total: 20, paymentDescription: 'Cartão', paymentAmount: 20 })).toThrow('nfce_item_tax_data_missing');
    const xml = buildNfceXml({ ...base, issuerName: 'Loja & Cia', stateRegistration: '123', items: [item], total: 20, paymentDescription: 'Cartão', paymentAmount: 20 });
    expect(xml).toContain('<NFe ');
    expect(xml).toContain('Produto &amp; teste');
    expect(xml).toContain('<mod>65</mod>');
  });

  it('builds the QR payload and parses an authorization response', () => {
    const key = buildNfceAccessKey(base);
    const url = buildNfceQrCodeUrl('https://sefaz.example/consulta', key, 2, '000001', 'test-csc');
    expect(url).toMatch(/^https:\/\/sefaz\.example\/consulta\?p=\d{44}\|2\|000001\|[a-f0-9]{40}$/);
    expect(parseSefazResponse('<retEnviNFe><cStat>100</cStat><xMotivo>Autorizado</xMotivo><protNFe><infProt><chNFe>123</chNFe><nProt>987</nProt></infProt></protNFe></retEnviNFe>')).toEqual({ statusCode: '100', statusMessage: 'Autorizado', protocol: '987', accessKey: '123' });
  });

  it('renders a thermal DANFE with homologation warning and print action', () => {
    const html = renderDanfeNfceHtml({ issuerName: 'Loja', cnpj: base.cnpj, stateRegistration: '123', series: 1, number: 42, issuedAt: base.issuedAt, accessKey: buildNfceAccessKey(base), protocol: '987', qrCodeUrl: 'data:image/png;base64,test', items: [item], total: 20, paymentDescription: 'Pix', environment: 'homologacao' });
    expect(html).toContain('width:74mm');
    expect(html).toContain('DOCUMENTO EMITIDO EM HOMOLOGAÇÃO');
    expect(html).toContain('window.print()');
  });
});
