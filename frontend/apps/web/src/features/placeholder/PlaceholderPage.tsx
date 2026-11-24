import { Card } from '@/components/ui';
import { t } from '@/lib/i18n';

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="font-sans text-sm font-medium uppercase tracking-label text-text">{title}</h1>
      <Card>
        <p className="text-sm text-text-2">{t('page.placeholder')}</p>
      </Card>
    </div>
  );
}
