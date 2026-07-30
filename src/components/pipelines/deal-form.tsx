"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  PipelineStage,
  Product,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Trash2, MessageSquare, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  createDealItemDraft,
  repriceAutoFilledItems,
  toDealItemInputs,
  validateDealItemDrafts,
  type DealItemDraft,
} from "@/lib/pipelines/deal-items";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  products: Product[];
  initialProductId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  products,
  initialProductId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [itemDrafts, setItemDrafts] = useState<DealItemDraft[]>([]);
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setCurrency(deal.currency || defaultCurrency);
      setItemDrafts(
        [...(deal.items ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((item) => ({
            key: item.id,
            product_id: item.product_id,
            quantity: String(item.quantity),
            unit_price: String(item.unit_price),
            autoPriced: false,
          }))
      );
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");
    } else {
      setTitle("");
      setCurrency(defaultCurrency);
      const initialProduct = products.find(
        (product) => product.id === initialProductId && product.is_active
      );
      setItemDrafts(
        initialProduct
          ? [
              createDealItemDraft(
                initialProduct,
                defaultCurrency,
                `new-${initialProduct.id}`
              ),
            ]
          : []
      );
      setContactId("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
    }
  }, [
    open,
    deal,
    defaultStageId,
    stages,
    defaultCurrency,
    initialProductId,
    products,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("toastRequired"));
      return;
    }
    const itemError = validateDealItemDrafts(itemDrafts);
    if (itemError) {
      toast.error(t(`itemErrors.${itemError}`));
      return;
    }
    if (!accountId) {
      toast.error(t("toastNotLinked"));
      return;
    }
    setSaving(true);

    const payload = {
      deal_id: deal?.id ?? null,
      title: title.trim(),
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
      items: toDealItemInputs(itemDrafts),
    };

    const { error } = await supabase.rpc("save_deal_with_items", {
      p_payload: payload,
    });
    if (error) {
      toast.error(deal ? t("toastFailedSave") : t("toastFailedCreate"));
      setSaving(false);
      return;
    }

    setSaving(false);
    toast.success(deal ? t("toastUpdated") : t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    setStatusAction(status);
    const { error } = await supabase
      .from("deals")
      .update({ status })
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t("toastFailedStatus"));
      return;
    }
    toast.success(
      status === "won"
        ? t("toastMarkedWon")
        : status === "lost"
          ? t("toastMarkedLost")
          : t("toastReopened")
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  const originalProductIds = new Set(
    (deal?.items ?? []).map((item) => item.product_id)
  );
  const selectableProducts = products.filter(
    (product) => product.is_active || originalProductIds.has(product.id)
  );
  const totalValue = itemDrafts.reduce((sum, item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return sum;
    return sum + quantity * unitPrice;
  }, 0);
  const itemValidation = validateDealItemDrafts(itemDrafts);

  function addItem() {
    setItemDrafts((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        product_id: "",
        quantity: "1",
        unit_price: "",
      },
    ]);
  }

  function updateItemProduct(key: string, productId: string) {
    setItemDrafts((current) =>
      current.map((item) => {
        if (item.key !== key) return item;
        const product = products.find(
          (candidate) => candidate.id === productId
        );
        if (!product) return { ...item, product_id: productId, unit_price: "" };
        return createDealItemDraft(product, currency, item.key);
      })
    );
  }

  function updateItem(
    key: string,
    field: "quantity" | "unit_price",
    value: string
  ) {
    setItemDrafts((current) =>
      current.map((item) =>
        item.key === key
          ? {
              ...item,
              [field]: value,
              ...(field === "unit_price" ? { autoPriced: false } : {}),
            }
          : item
      )
    );
  }

  function updateCurrency(nextCurrency: string) {
    setCurrency(nextCurrency);
    setItemDrafts((current) =>
      repriceAutoFilledItems(current, products, nextCurrency)
    );
  }

  function removeItem(key: string) {
    setItemDrafts((current) => current.filter((item) => item.key !== key));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground w-full p-0 sm:max-w-2xl"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-border/50 border-b p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t("editDeal") : t("newDeal")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("title")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("contact")}</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              >
                <option value="">{t("selectContact")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="bg-primary/10 text-primary hover:bg-primary/20 mt-1 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs"
                >
                  <MessageSquare className="h-3 w-3" />
                  {t("linkToConversation")}
                </Link>
              )}
            </div>

            <div className="grid max-w-40 gap-2">
              <Label className="text-muted-foreground">{t("currency")}</Label>
              <select
                value={currency}
                onChange={(e) => updateCurrency(e.target.value)}
                className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-border bg-muted/30 space-y-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label className="text-foreground">{t("products")}</Label>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {t("productsHint")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItem}
                  disabled={itemDrafts.length >= selectableProducts.length}
                >
                  <Plus className="size-4" />
                  {t("addProduct")}
                </Button>
              </div>

              {itemDrafts.length === 0 ? (
                <div className="border-border text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
                  {t("noProducts")}
                </div>
              ) : (
                <div className="space-y-2">
                  {itemDrafts.map((item) => {
                    const selectedProductIds = new Set(
                      itemDrafts
                        .filter((candidate) => candidate.key !== item.key)
                        .map((candidate) => candidate.product_id)
                    );
                    const subtotal =
                      Number(item.quantity || 0) * Number(item.unit_price || 0);
                    return (
                      <div
                        key={item.key}
                        className="border-border bg-card grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_88px_112px_104px_36px]"
                      >
                        <div className="grid gap-1">
                          <Label className="text-muted-foreground text-[11px]">
                            {t("product")}
                          </Label>
                          <select
                            value={item.product_id}
                            onChange={(event) =>
                              updateItemProduct(item.key, event.target.value)
                            }
                            className="border-border bg-muted text-foreground focus:border-primary h-9 min-w-0 rounded-lg border px-2 text-sm outline-none"
                          >
                            <option value="">{t("selectProduct")}</option>
                            {selectableProducts.map((product) => (
                              <option
                                key={product.id}
                                value={product.id}
                                disabled={selectedProductIds.has(product.id)}
                              >
                                {product.name}
                                {!product.is_active
                                  ? ` (${t("inactiveProduct")})`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-muted-foreground text-[11px]">
                            {t("quantity")}
                          </Label>
                          <Input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={item.quantity}
                            onChange={(event) =>
                              updateItem(
                                item.key,
                                "quantity",
                                event.target.value
                              )
                            }
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-muted-foreground text-[11px]">
                            {t("unitPrice")}
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(event) =>
                              updateItem(
                                item.key,
                                "unit_price",
                                event.target.value
                              )
                            }
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-muted-foreground text-[11px]">
                            {t("subtotal")}
                          </Label>
                          <div className="bg-muted text-foreground flex h-9 items-center truncate rounded-lg px-2 text-sm font-medium">
                            {new Intl.NumberFormat(undefined, {
                              style: "currency",
                              currency,
                            }).format(Number.isFinite(subtotal) ? subtotal : 0)}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(item.key)}
                          aria-label={t("removeProduct")}
                          className="text-destructive hover:text-destructive self-end"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-border flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground text-sm font-medium">
                  {t("total")}
                </span>
                <span className="text-foreground text-lg font-semibold">
                  {new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency,
                  }).format(totalValue)}
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                {t("expectedCloseDate")}
              </Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("stage")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("assignedTo")}</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="border-border bg-muted text-foreground focus:border-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
              >
                <option value="">{t("unassigned")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("notes")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="border-border bg-muted text-foreground min-h-[100px]"
              />
            </div>

            {deal && (
              <div className="border-border bg-muted/50 space-y-2 rounded-lg border p-3">
                <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  {t("status")}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("won")}
                    disabled={!!statusAction || deal.status === "won"}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 disabled:opacity-50"
                  >
                    {statusAction === "won" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        {t("markAsWon")}
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("lost")}
                    disabled={!!statusAction || deal.status === "lost"}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {statusAction === "lost" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        {t("markAsLost")}
                      </>
                    )}
                  </Button>
                </div>
                {deal.status && deal.status !== "open" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange("open")}
                    disabled={!!statusAction}
                    className="text-muted-foreground hover:text-foreground w-full"
                  >
                    {t("reopenDeal")}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="border-border/50 bg-popover/80 border-t p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted flex-1 bg-transparent"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  saving ||
                  !title.trim() ||
                  !contactId ||
                  !stageId ||
                  itemValidation !== null
                }
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1"
              >
                {saving
                  ? t("saving")
                  : deal
                    ? t("saveChanges")
                    : t("createDeal")}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("deletePrompt")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="text-muted-foreground hover:bg-muted rounded px-2 py-1"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("deleteDeal")}
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
