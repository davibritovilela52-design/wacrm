import { describe, expect, it } from 'vitest';

import type { Product } from '@/types';
import {
  createDealItemDraft,
  repriceAutoFilledItems,
  toDealItemInputs,
  validateDealItemDrafts,
} from './deal-items';

const product: Product = {
  id: 'product-1',
  account_id: 'account-1',
  created_by: 'user-1',
  name: 'Decizyon Sales',
  code: 'SALES',
  description: null,
  default_unit_price: 199.9,
  currency: 'BRL',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('deal item drafts', () => {
  it('copies the default price only when product and deal currencies match', () => {
    expect(createDealItemDraft(product, 'BRL', 'row-1')).toMatchObject({
      key: 'row-1',
      product_id: 'product-1',
      quantity: '1',
      unit_price: '199.9',
    });
    expect(createDealItemDraft(product, 'USD', 'row-2').unit_price).toBe('');
  });

  it('clears only auto-filled prices when the deal currency becomes incompatible', () => {
    const autoFilled = createDealItemDraft(product, 'BRL', 'row-1');
    const manual = {
      ...createDealItemDraft(product, 'BRL', 'row-2'),
      unit_price: '175',
      autoPriced: false,
    };

    expect(
      repriceAutoFilledItems([autoFilled, manual], [product], 'USD')
    ).toEqual([{ ...autoFilled, unit_price: '' }, manual]);
    expect(
      repriceAutoFilledItems(
        [{ ...autoFilled, unit_price: '' }],
        [product],
        'BRL'
      )[0]?.unit_price
    ).toBe('199.9');
  });

  it('requires at least one complete item', () => {
    expect(validateDealItemDrafts([])).toBe('required');
    expect(
      validateDealItemDrafts([
        {
          key: 'row-1',
          product_id: '',
          quantity: '1',
          unit_price: '10',
        },
      ])
    ).toBe('product');
  });

  it('rejects duplicate products, invalid quantities, and invalid prices', () => {
    expect(
      validateDealItemDrafts([
        {
          key: 'row-1',
          product_id: 'product-1',
          quantity: '1',
          unit_price: '10',
        },
        {
          key: 'row-2',
          product_id: 'product-1',
          quantity: '2',
          unit_price: '10',
        },
      ])
    ).toBe('duplicate');
    expect(
      validateDealItemDrafts([
        {
          key: 'row-1',
          product_id: 'product-1',
          quantity: '0',
          unit_price: '10',
        },
      ])
    ).toBe('quantity');
    expect(
      validateDealItemDrafts([
        {
          key: 'row-1',
          product_id: 'product-1',
          quantity: '1',
          unit_price: '-1',
        },
      ])
    ).toBe('unit-price');
  });

  it('normalizes valid rows with deterministic positions', () => {
    expect(
      toDealItemInputs([
        {
          key: 'row-1',
          product_id: 'product-1',
          quantity: '2.5',
          unit_price: '100.25',
        },
      ])
    ).toEqual([
      {
        product_id: 'product-1',
        quantity: 2.5,
        unit_price: 100.25,
        position: 0,
      },
    ]);
  });
});
