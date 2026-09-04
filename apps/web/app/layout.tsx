import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'VetorOS 2', description: 'Fundação segura para gestão de assistências técnicas.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
