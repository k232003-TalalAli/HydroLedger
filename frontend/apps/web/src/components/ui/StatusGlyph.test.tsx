import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusGlyph } from './StatusGlyph';

describe('StatusGlyph', () => {
  it('pairs glyph with accessible label', () => {
    render(<StatusGlyph status="critical" />);
    expect(screen.getByRole('img', { name: 'Critical' })).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('renders warning label', () => {
    render(<StatusGlyph status="warning" />);
    expect(screen.getByRole('img', { name: 'Warning' })).toBeInTheDocument();
  });
});
