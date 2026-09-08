import { PageHeader } from '../../../../components/page-header';
import { SupplierForm } from '../supplier-form';

export default function NewSupplierPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Novo fornecedor" />
      <SupplierForm />
    </div>
  );
}
