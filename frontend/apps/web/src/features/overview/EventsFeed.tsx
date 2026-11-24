import type { AuditEvent } from '@hydroledger/shared';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';
import { formatRelativeTime, truncateHash } from '@/lib/format';

interface EventsFeedProps {
  events: AuditEvent[];
}

export function EventsFeed({ events }: EventsFeedProps) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="label-caps text-text">Recent events</h2>
        <Link to="/ledger" className="text-[11px] text-accent underline">
          View ledger
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-text-2">No events yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.slice(0, 8).map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0"
            >
              <div>
                <p className="font-mono text-xs text-text">{e.name}</p>
                <p className="text-[10px] text-text-2">{e.payload}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] text-text-2">{formatRelativeTime(e.ts)}</p>
                {e.txHash ? (
                  <p className="font-mono text-[10px] text-accent">{truncateHash(e.txHash)}</p>
                ) : (
                  <p className="font-mono text-[10px] text-text-2">MQTT</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
