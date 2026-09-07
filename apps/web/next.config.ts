import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Next 16.3.4 habilita o runner CLI por padrão. No Node 24 o subprocesso pode encerrar antes
  // de entregar todo o JSON de `tsc --showConfig`; a Compiler API mantém a mesma validação de
  // tipos dentro do build sem depender dessa captura sujeita à corrida.
  experimental: { useTypeScriptCli: false },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}` },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ] }];
  },
};
export default nextConfig;
