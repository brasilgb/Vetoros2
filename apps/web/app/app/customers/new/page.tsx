import { PageHeader } from '../../../../components/page-header';
import { CustomerForm } from '../customer-form';

export default function NewCustomerPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Novo cliente" />
      <CustomerForm />
    </div>
  );
}
