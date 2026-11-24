import { visibleNavRoutes } from '@hydroledger/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/store/session';
import { Sidebar } from './Sidebar';

describe('Sidebar role gating', () => {
  beforeEach(() => {
    useSessionStore.setState({ role: 'citizen' });
  });

  afterEach(() => {
    cleanup();
  });

  it('hides valves and admin for citizen', () => {
    render(
      <MemoryRouter>
        <Sidebar collapsed={false} onToggle={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Valves')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(visibleNavRoutes('citizen')).not.toContain('valves');
  });

  it('shows valves for operator but not admin', () => {
    useSessionStore.setState({ role: 'operator' });
    render(
      <MemoryRouter>
        <Sidebar collapsed={false} onToggle={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Valves')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
});
