import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Charts from './Charts.tsx';

describe('<Charts>', () => {
  it('renders nothing when there are no charts', () => {
    const { container } = render(<Charts charts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders nothing for undefined', () => {
    const { container } = render(<Charts />);
    expect(container).toBeEmptyDOMElement();
  });
});
