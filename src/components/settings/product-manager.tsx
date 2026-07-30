'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Package, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import type { Product } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { CURRENCIES, formatCurrency } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface ProductDraft {
  name: string;
  code: string;
  description: string;
  defaultUnitPrice: string;
  currency: string;
  isActive: boolean;
}

function emptyDraft(currency: string): ProductDraft {
  return {
    name: '',
    code: '',
    description: '',
    defaultUnitPrice: '0',
    currency,
    isActive: true,
  };
}

export function ProductManager() {
  const t = useTranslations('Settings.deals.products');
  const supabase = createClient();
  const { accountId, canEditSettings, defaultCurrency, profileLoading, user } =
    useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(() =>
    emptyDraft(defaultCurrency)
  );
  const [saving, setSaving] = useState(false);

  const loadProducts = useCallback(async () => {
    if (!accountId) {
      setProducts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name');
    if (error) {
      toast.error(t('loadFailed'));
      setLoading(false);
      return;
    }
    setProducts((data ?? []) as Product[]);
    setLoading(false);
  }, [accountId, supabase, t]);

  useEffect(() => {
    // Loading the account-scoped catalog is the external synchronization
    // performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProducts();
  }, [loadProducts]);

  function openCreate() {
    setEditingProduct(null);
    setDraft(emptyDraft(defaultCurrency));
    setDialogOpen(true);
  }

  function openEdit(product: Product) {
    setEditingProduct(product);
    setDraft({
      name: product.name,
      code: product.code ?? '',
      description: product.description ?? '',
      defaultUnitPrice: String(product.default_unit_price),
      currency: product.currency,
      isActive: product.is_active,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = draft.name.trim();
    const defaultUnitPrice = Number(draft.defaultUnitPrice);
    if (
      !name ||
      draft.defaultUnitPrice.trim() === '' ||
      !Number.isFinite(defaultUnitPrice) ||
      defaultUnitPrice < 0
    ) {
      toast.error(t('invalid'));
      return;
    }
    if (!accountId || !user) {
      toast.error(t('notAuthenticated'));
      return;
    }

    setSaving(true);
    const payload = {
      name,
      code: draft.code.trim() || null,
      description: draft.description.trim() || null,
      default_unit_price: defaultUnitPrice,
      currency: draft.currency,
      is_active: draft.isActive,
    };
    const result = editingProduct
      ? await supabase
          .from('products')
          .update(payload)
          .eq('id', editingProduct.id)
      : await supabase.from('products').insert({
          ...payload,
          account_id: accountId,
          created_by: user.id,
        });

    if (result.error) {
      toast.error(t('saveFailed'));
      setSaving(false);
      return;
    }

    toast.success(editingProduct ? t('updated') : t('created'));
    setSaving(false);
    setDialogOpen(false);
    await loadProducts();
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Package className="text-primary size-4" />
              {t('title')}
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              {t('description')}
            </CardDescription>
          </div>
          {canEditSettings && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" />
              {t('add')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading || profileLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="text-primary size-5 animate-spin" />
            </div>
          ) : products.length === 0 ? (
            <div className="border-border rounded-lg border border-dashed px-4 py-8 text-center">
              <p className="text-foreground text-sm font-medium">
                {t('empty')}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('emptyHint')}
              </p>
            </div>
          ) : (
            <div className="divide-border border-border divide-y rounded-lg border">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center gap-3 px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-foreground truncate text-sm font-medium">
                        {product.name}
                      </p>
                      {product.code && (
                        <Badge variant="outline">{product.code}</Badge>
                      )}
                      {!product.is_active && (
                        <Badge variant="secondary">{t('inactive')}</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatCurrency(
                        Number(product.default_unit_price),
                        product.currency
                      )}
                    </p>
                  </div>
                  {canEditSettings && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(product)}
                      aria-label={t('editAria', { name: product.name })}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!canEditSettings && (
            <p className="text-muted-foreground mt-3 text-xs">
              {t('adminOnly')}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? t('editTitle') : t('createTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>{t('name')}</Label>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                maxLength={120}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t('code')}</Label>
              <Input
                value={draft.code}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
                maxLength={40}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t('descriptionLabel')}</Label>
              <Textarea
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className="min-h-20"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <div className="grid gap-2">
                <Label>{t('defaultPrice')}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.defaultUnitPrice}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      defaultUnitPrice: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>{t('currency')}</Label>
                <select
                  value={draft.currency}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      currency: event.target.value,
                    }))
                  }
                  className="border-border bg-muted text-foreground h-9 rounded-lg border px-2.5 text-sm"
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {editingProduct && (
              <div className="border-border flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>{t('active')}</Label>
                  <p className="text-muted-foreground text-xs">
                    {t('activeHint')}
                  </p>
                </div>
                <Switch
                  checked={draft.isActive}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      isActive: Boolean(checked),
                    }))
                  }
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !draft.name.trim()}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
