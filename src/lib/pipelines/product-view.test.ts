import { describe, expect, it } from 'vitest';

import type { Deal, PipelineStage, ProductFilter } from '@/types';
import {
  computePipelineMetrics,
  filterDealsByProduct,
  getDealValueForFilter,
} from './product-view';

const stages: PipelineStage[] = [
  {
    id: 'stage-new',
    pipeline_id: 'pipeline-1',
    name: 'New',
    position: 0,
    color: '#000000',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'stage-won',
    pipeline_id: 'pipeline-1',
    name: 'Won',
    position: 1,
    color: '#00ff00',
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

function deal(
  overrides: Partial<Deal> & Pick<Deal, 'id' | 'stage_id' | 'value'>
): Deal {
  return {
    user_id: 'user-1',
    pipeline_id: 'pipeline-1',
    contact_id: 'contact-1',
    title: overrides.id,
    currency: 'BRL',
    status: 'open',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const productAFilter: ProductFilter = {
  kind: 'product',
  productId: 'product-a',
};

describe('pipeline product view', () => {
  it('filters deals without duplicating a deal that contains the selected product', () => {
    const deals = [
      deal({
        id: 'deal-a',
        stage_id: 'stage-new',
        value: 350,
        items: [
          {
            id: 'item-a',
            account_id: 'account-1',
            deal_id: 'deal-a',
            product_id: 'product-a',
            quantity: 2,
            unit_price: 100,
            position: 0,
            created_at: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'item-b',
            account_id: 'account-1',
            deal_id: 'deal-a',
            product_id: 'product-b',
            quantity: 1,
            unit_price: 150,
            position: 1,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      deal({ id: 'deal-b', stage_id: 'stage-new', value: 500, items: [] }),
    ];

    expect(
      filterDealsByProduct(deals, productAFilter).map((item) => item.id)
    ).toEqual(['deal-a']);
  });

  it('uses the selected product subtotal instead of the full deal value', () => {
    const selectedDeal = deal({
      id: 'deal-a',
      stage_id: 'stage-new',
      value: 350,
      items: [
        {
          id: 'item-a',
          account_id: 'account-1',
          deal_id: 'deal-a',
          product_id: 'product-a',
          quantity: 2.5,
          unit_price: 100,
          position: 0,
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'item-b',
          account_id: 'account-1',
          deal_id: 'deal-a',
          product_id: 'product-b',
          quantity: 1,
          unit_price: 100,
          position: 1,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(getDealValueForFilter(selectedDeal, productAFilter)).toBe(250);
    expect(getDealValueForFilter(selectedDeal, { kind: 'all' })).toBe(350);
  });

  it('keeps legacy deals and their historical value in the unassigned view', () => {
    const legacyDeal = deal({
      id: 'legacy',
      stage_id: 'stage-new',
      value: 900,
    });
    const assignedDeal = deal({
      id: 'assigned',
      stage_id: 'stage-new',
      value: 100,
      items: [
        {
          id: 'item-a',
          account_id: 'account-1',
          deal_id: 'assigned',
          product_id: 'product-a',
          quantity: 1,
          unit_price: 100,
          position: 0,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const filter: ProductFilter = { kind: 'unassigned' };

    expect(filterDealsByProduct([legacyDeal, assignedDeal], filter)).toEqual([
      legacyDeal,
    ]);
    expect(getDealValueForFilter(legacyDeal, filter)).toBe(900);
  });

  it('computes product-attributed analytics while preserving deal counts', () => {
    const deals = [
      deal({
        id: 'open',
        stage_id: 'stage-new',
        value: 500,
        items: [
          {
            id: 'open-a',
            account_id: 'account-1',
            deal_id: 'open',
            product_id: 'product-a',
            quantity: 2,
            unit_price: 100,
            position: 0,
            created_at: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'open-b',
            account_id: 'account-1',
            deal_id: 'open',
            product_id: 'product-b',
            quantity: 1,
            unit_price: 300,
            position: 1,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      deal({
        id: 'won',
        stage_id: 'stage-won',
        value: 100,
        status: 'won',
        updated_at: '2026-07-10T12:00:00.000Z',
        items: [
          {
            id: 'won-a',
            account_id: 'account-1',
            deal_id: 'won',
            product_id: 'product-a',
            quantity: 1,
            unit_price: 100,
            position: 0,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      deal({
        id: 'lost',
        stage_id: 'stage-new',
        value: 800,
        status: 'lost',
        updated_at: '2026-07-15T12:00:00.000Z',
        items: [
          {
            id: 'lost-a',
            account_id: 'account-1',
            deal_id: 'lost',
            product_id: 'product-a',
            quantity: 8,
            unit_price: 100,
            position: 0,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ];

    expect(
      computePipelineMetrics(
        stages,
        deals,
        productAFilter,
        new Date('2026-07-30')
      )
    ).toEqual({
      totalDeals: 2,
      pipelineValue: 300,
      avgDealSize: 150,
      weightedValue: 20,
      wonThisMonth: 1,
      lostThisMonth: 1,
    });
  });
});
