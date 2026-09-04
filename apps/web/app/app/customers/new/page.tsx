import Link from 'next/link';import { CustomerForm } from '../customer-form';
export default function NewCustomerPage(){return <main className="mx-auto max-w-4xl p-8"><Link href="/app/customers" className="text-emerald-300">← Clientes</Link><h1 className="mt-4 text-3xl font-bold">Novo cliente</h1><CustomerForm/></main>}
