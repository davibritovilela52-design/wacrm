import type { DealItemInput, Product } from '@/types';

export interface DealItemDraft {
  key: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  /** True while the price is controlled by product/currency defaults. */
  autoPriced?: boolean;
}

export type DealItemsValidationError =
  'required' | 'product' | 'duplicate' | 'quantity' | 'unit-price';

export function createDealItemDraft(
  product: Product,
  dealCurrency: string,
  key: string
): DealItemDraft {
  return {
    key,
    product_id: product.id,
    quantity: '1',
    unit_price:
      product.currency === dealCurrency
        ? String(Number(product.default_unit_price || 0))
        : '',
    autoPriced: true,
  };
}

export function repriceAutoFilledItems(
  items: DealItemDraft[],
  products: Product[],
  dealCurrency: string
): DealItemDraft[] {
  const productById = new Map(products.map((product) => [product.id, product]));

  return items.map((item) => {
    if (!item.autoPriced) return item;
    const product = productById.get(item.product_id);
    return {
      ...item,
      unit_price:
        product?.currency === dealCurrency
          ? String(Number(product.default_unit_price || 0))
          : '',
    };
  });
}

export function validateDealItemDrafts(
  items: DealItemDraft[]
): DealItemsValidationError | null {
  if (items.length === 0) return 'required';
  if (items.some((item) => !item.product_id)) return 'product';

  const productIds = items.map((item) => item.product_id);
  if (new Set(productIds).size !== productIds.length) return 'duplicate';

  if (
    items.some((item) => {
      const quantity = Number(item.quantity);
      return (
        item.quantity.trim() === '' ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      );
    })
  ) {
    return 'quantity';
  }

  if (
    items.some((item) => {
      const unitPrice = Number(item.unit_price);
      return (
        item.unit_price.trim() === '' ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      );
    })
  ) {
    return 'unit-price';
  }

  return null;
}

export function toDealItemInputs(items: DealItemDraft[]): DealItemInput[] {
  return items.map((item, position) => ({
    product_id: item.product_id,
    quantity: Number(item.quantity),
    unit_price: Number(item.unit_price),
    position,
  }));
}
