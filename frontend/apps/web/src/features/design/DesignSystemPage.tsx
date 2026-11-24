import { useState } from 'react';
import {
  Button,
  Card,
  Chip,
  DataTable,
  Modal,
  Skeleton,
  StatusGlyph,
  Tooltip,
} from '@/components/ui';

export function DesignSystemPage() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-16">
      <header className="space-y-1">
        <p className="label-caps text-accent">Internal</p>
        <h1 className="font-sans text-2xl font-bold text-text">Design system states</h1>
        <p className="text-sm text-text-2">
          Hidden route for visual review and Playwright snapshots. No red or green.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="label-caps">StatusGlyph</h2>
        <div className="flex flex-wrap gap-4">
          <StatusGlyph status="normal" />
          <StatusGlyph status="warning" />
          <StatusGlyph status="critical" />
          <StatusGlyph status="stale" />
          <StatusGlyph status="offline" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps">Buttons</h2>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps">Cards</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <p className="label-caps">Normal</p>
            <p className="mt-2 font-mono text-2xl font-bold">42.6</p>
            <p className="text-xs text-text-2">L/min</p>
          </Card>
          <Card hazard>
            <p className="label-caps">Warning / hazard edge</p>
            <p className="mt-2 font-mono text-2xl font-bold text-accent">4.5</p>
            <p className="text-xs text-text-2">ΔQ L/min</p>
          </Card>
          <Card critical>
            <p className="label-caps">Critical pulse</p>
            <p className="mt-2 font-mono text-2xl font-bold">LEAK</p>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps">Chips · Tooltip · Modal</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Chip>Pending</Chip>
          <Chip accent>✓ Anchored</Chip>
          <Tooltip content="0x9f3a12abc21e">
            <Chip accent>0x9f3a…c21e</Chip>
          </Tooltip>
          <Button variant="outline" size="sm" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps">Loading · Empty · Table</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-24 w-full" />
          <DataTable
            columns={[
              { key: 'id', header: 'ID', render: (r) => r.id },
              { key: 'flow', header: 'L/min', render: (r) => r.flow },
            ]}
            rows={[
              { id: 'N1', flow: '42.6' },
              { id: 'N2', flow: '38.1' },
            ]}
            getRowKey={(r) => r.id}
          />
        </div>
        <DataTable
          columns={[{ key: 'x', header: 'X', render: () => null }]}
          rows={[] as { id: string }[]}
          getRowKey={(r) => r.id}
          emptyMessage="No alerts yet."
        />
      </section>

      <section className="space-y-3">
        <h2 className="label-caps">Typography</h2>
        <p className="label-caps">Space Grotesk label · tracking 0.12em</p>
        <p className="font-mono text-3xl font-bold">42.6 L/min</p>
        <p className="font-mono text-xs text-text-2">
          0x9f3a12AbCdEf9876543210FeDcBa0987654321c21e
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps">Stale node tile</h2>
        <div className="inline-flex items-center gap-2 rounded-card border border-dashed border-text-2 px-3 py-2 opacity-60">
          <StatusGlyph status="stale" showLabel={false} />
          <div>
            <p className="font-mono text-sm">N3</p>
            <p className="font-mono text-[11px] text-text-2">Last seen 38s ago</p>
          </div>
        </div>
      </section>

      <Modal
        open={modalOpen}
        title="Close valve"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setModalOpen(false)}>Confirm</Button>
          </>
        }
      >
        Destructive actions require confirmation. Reason field and wallet signature land in Phase 6.
      </Modal>
    </div>
  );
}
