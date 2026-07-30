import type { Product, ProductFilter } from '@/types';

export function parseProductFilter(
  value: string | null,
  products: Product[]
): ProductFilter {
  if (value === 'unassigned') return { kind: 'unassigned' };
  if (value && products.some((product) => product.id === value)) {
    return { kind: 'product', productId: value };
  }
  return { kind: 'all' };
}

export function productFilterParam(filter: ProductFilter): string | null {
  if (filter.kind === 'all') return null;
  if (filter.kind === 'unassigned') return 'unassigned';
  return filter.productId;
}

export function productFilterSelection(filter: ProductFilter): string {
  return productFilterParam(filter) ?? 'all';
}
