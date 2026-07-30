'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Package, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Deal, Product, ProductFilter } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ProductFilterSelectProps {
  deals: Deal[];
  disabled?: boolean;
  filter: ProductFilter;
  onChange: (filter: ProductFilter) => void;
  products: Product[];
}

export function ProductFilterSelect({
  deals,
  disabled,
  filter,
  onChange,
  products,
}: ProductFilterSelectProps) {
  const t = useTranslations('Pipelines.productFilter');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const referencedProductIds = useMemo(
    () =>
      new Set(
        deals.flatMap((deal) =>
          (deal.items ?? []).map((item) => item.product_id)
        )
      ),
    [deals]
  );
  const availableProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          product.is_active ||
          referencedProductIds.has(product.id) ||
          (filter.kind === 'product' && filter.productId === product.id)
      ),
    [filter, products, referencedProductIds]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingProducts = availableProducts.filter((product) => {
    if (!normalizedQuery) return true;
    return (
      product.name.toLocaleLowerCase().includes(normalizedQuery) ||
      product.code?.toLocaleLowerCase().includes(normalizedQuery)
    );
  });
  const selectedProduct =
    filter.kind === 'product'
      ? products.find((product) => product.id === filter.productId)
      : null;
  const label =
    filter.kind === 'all'
      ? t('all')
      : filter.kind === 'unassigned'
        ? t('unassigned')
        : (selectedProduct?.name ?? t('all'));

  function select(next: ProductFilter) {
    onChange(next);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="bg-card min-w-48 justify-between"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <Package className="text-primary size-4 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <div className="border-border relative border-b p-2">
          <Search className="text-muted-foreground absolute top-1/2 left-4 size-4 -translate-y-1/2" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            className="pl-8"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          <FilterOption
            checked={filter.kind === 'all'}
            label={t('all')}
            onClick={() => select({ kind: 'all' })}
          />
          <FilterOption
            checked={filter.kind === 'unassigned'}
            label={t('unassigned')}
            onClick={() => select({ kind: 'unassigned' })}
          />
          {matchingProducts.length > 0 && (
            <div className="border-border my-1 border-t" />
          )}
          {matchingProducts.map((product) => (
            <FilterOption
              key={product.id}
              checked={
                filter.kind === 'product' && filter.productId === product.id
              }
              label={product.name}
              meta={
                !product.is_active ? t('inactive') : product.code || undefined
              }
              onClick={() => select({ kind: 'product', productId: product.id })}
            />
          ))}
          {matchingProducts.length === 0 && normalizedQuery && (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              {t('noResults')}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterOption({
  checked,
  label,
  meta,
  onClick,
}: {
  checked: boolean;
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm',
        checked && 'bg-primary/10 text-primary'
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {checked && <Check className="size-4" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta && (
        <span className="text-muted-foreground max-w-24 truncate text-xs">
          {meta}
        </span>
      )}
    </button>
  );
}
