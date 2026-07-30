import type { Deal, PipelineStage, ProductFilter } from '@/types';

export interface PipelineMetrics {
  totalDeals: number;
  pipelineValue: number;
  avgDealSize: number;
  weightedValue: number;
  wonThisMonth: number;
  lostThisMonth: number;
}

export function getDealValueForFilter(
  deal: Deal,
  filter: ProductFilter
): number {
  if (filter.kind !== 'product') return Number(deal.value || 0);

  return (deal.items ?? [])
    .filter((item) => item.product_id === filter.productId)
    .reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
      0
    );
}

export function filterDealsByProduct(
  deals: Deal[],
  filter: ProductFilter
): Deal[] {
  if (filter.kind === 'all') return deals;
  if (filter.kind === 'unassigned') {
    return deals.filter((deal) => (deal.items?.length ?? 0) === 0);
  }
  return deals.filter((deal) =>
    deal.items?.some((item) => item.product_id === filter.productId)
  );
}

function computeStageProbability(
  stage: PipelineStage,
  sortedStages: PipelineStage[]
): number {
  const count = sortedStages.length;
  if (count <= 1) return 1;

  const index = sortedStages.findIndex(
    (candidate) => candidate.id === stage.id
  );
  if (index < 0) return 0;
  if (index === count - 1) return 1;

  const openStageSlots = count - 1;
  if (openStageSlots <= 1) return 0.1;

  const progress = index / (openStageSlots - 1);
  return 0.1 + progress * 0.8;
}

export function computePipelineMetrics(
  stages: PipelineStage[],
  deals: Deal[],
  filter: ProductFilter,
  now = new Date()
): PipelineMetrics {
  const visibleDeals = filterDealsByProduct(deals, filter);
  const activeDeals = visibleDeals.filter((deal) => deal.status !== 'lost');
  const openDeals = activeDeals.filter((deal) => deal.status !== 'won');
  const sortedStages = [...stages].sort((a, b) => a.position - b.position);
  const stageById = new Map(sortedStages.map((stage) => [stage.id, stage]));

  const pipelineValue = activeDeals.reduce(
    (sum, deal) => sum + getDealValueForFilter(deal, filter),
    0
  );
  const totalDeals = activeDeals.length;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const changedThisMonth = (deal: Deal) => {
    const timestamp = deal.updated_at ?? deal.created_at;
    return Boolean(timestamp && new Date(timestamp) >= monthStart);
  };

  return {
    totalDeals,
    pipelineValue,
    avgDealSize: totalDeals > 0 ? pipelineValue / totalDeals : 0,
    weightedValue: openDeals.reduce((sum, deal) => {
      const stage = stageById.get(deal.stage_id);
      if (!stage) return sum;
      return (
        sum +
        getDealValueForFilter(deal, filter) *
          computeStageProbability(stage, sortedStages)
      );
    }, 0),
    wonThisMonth: visibleDeals.filter(
      (deal) => deal.status === 'won' && changedThisMonth(deal)
    ).length,
    lostThisMonth: visibleDeals.filter(
      (deal) => deal.status === 'lost' && changedThisMonth(deal)
    ).length,
  };
}
