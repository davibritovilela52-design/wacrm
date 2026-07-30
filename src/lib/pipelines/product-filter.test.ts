import { describe, expect, it } from 'vitest';

import type { Product } from '@/types';
import {
  parseProductFilter,
  productFilterParam,
  productFilterSelection,
} from './product-filter';

const products = [
  { id: 'product-a', name: 'A' },
  { id: 'product-b', name: 'B' },
] as Product[];

describe('pipeline product filter URL contract', () => {
  it('parses known products and the unassigned sentinel', () => {
    expect(parseProductFilter('product-a', products)).toEqual({
      kind: 'product',
      productId: 'product-a',
    });
    expect(parseProductFilter('unassigned', products)).toEqual({
      kind: 'unassigned',
    });
  });

  it('falls back to all for missing or unknown products', () => {
    expect(parseProductFilter(null, products)).toEqual({ kind: 'all' });
    expect(parseProductFilter('foreign-product', products)).toEqual({
      kind: 'all',
    });
  });

  it('serializes all by removing the query parameter', () => {
    expect(productFilterParam({ kind: 'all' })).toBeNull();
    expect(productFilterParam({ kind: 'unassigned' })).toBe('unassigned');
    expect(
      productFilterParam({ kind: 'product', productId: 'product-a' })
    ).toBe('product-a');
  });

  it('maps filters to select values', () => {
    expect(productFilterSelection({ kind: 'all' })).toBe('all');
    expect(productFilterSelection({ kind: 'unassigned' })).toBe('unassigned');
    expect(
      productFilterSelection({ kind: 'product', productId: 'product-a' })
    ).toBe('product-a');
  });
});
