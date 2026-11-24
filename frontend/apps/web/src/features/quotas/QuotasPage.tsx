import { Skeleton } from '@/components/ui';
import { QuotaBars } from '@/features/overview/QuotaBars';
import { useDashboard } from '@/data/hooks';

export function QuotasPage() {
  const { data, isLoading } = useDashboard();
  if (isLoading || !data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <h1 className="font-sans text-sm font-medium uppercase tracking-label">Quotas</h1>
      <p className="text-sm text-text-2">
        On-chain daily volume vs quota. Day length: {data.chain.dayLengthSeconds}s (demo often 600).
      </p>
      <QuotaBars sectors={data.sectors} />
    </div>
  );
}
