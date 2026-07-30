-- ============================================================
-- Account-wide product catalog and normalized deal line items.
--
-- Additive migration:
--   * existing deals keep their historical `value`
--   * no legacy deal is backfilled with an invented product
--   * once a deal receives items, its value is derived from them
-- ============================================================

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  code TEXT,
  description TEXT,
  default_unit_price NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (default_unit_price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_account_id_unique UNIQUE (account_id, id),
  CONSTRAINT products_code_not_blank CHECK (code IS NULL OR btrim(code) <> '')
);

CREATE UNIQUE INDEX products_account_name_unique
  ON products (account_id, lower(name));
CREATE UNIQUE INDEX products_account_code_unique
  ON products (account_id, lower(code))
  WHERE code IS NOT NULL;
CREATE INDEX products_account_active_name_idx
  ON products (account_id, is_active, name);

-- Composite tenant FK support for deal_items.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'deals'::regclass
      AND conname = 'deals_account_id_id_unique'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_account_id_id_unique UNIQUE (account_id, id);
  END IF;
END
$$;

CREATE TABLE deal_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, deal_id, product_id),
  CONSTRAINT deal_items_deal_tenant_fk
    FOREIGN KEY (account_id, deal_id)
    REFERENCES deals(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT deal_items_product_tenant_fk
    FOREIGN KEY (account_id, product_id)
    REFERENCES products(account_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX deal_items_deal_position_idx
  ON deal_items (deal_id, position);
CREATE INDEX deal_items_account_product_deal_idx
  ON deal_items (account_id, product_id, deal_id);

DROP TRIGGER IF EXISTS set_updated_at ON products;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS and direct table privileges
-- ============================================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_select ON products
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY products_insert ON products
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'admin')
    AND created_by = auth.uid()
  );
CREATE POLICY products_update ON products
  FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Items are readable by account members. Mutations deliberately have no
-- authenticated RLS policy; all item writes go through the atomic RPC.
CREATE POLICY deal_items_select ON deal_items
  FOR SELECT USING (is_account_member(account_id));

GRANT SELECT, INSERT, UPDATE ON products TO authenticated;
REVOKE DELETE ON products FROM anon, authenticated;
GRANT SELECT ON deal_items TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON deal_items FROM anon, authenticated;

-- ============================================================
-- Keep deals.value synchronized once line items exist.
-- ============================================================

CREATE FUNCTION sync_deal_value_from_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_deal_id UUID := COALESCE(NEW.deal_id, OLD.deal_id);
  target_account_id UUID := COALESCE(NEW.account_id, OLD.account_id);
BEGIN
  UPDATE public.deals
  SET
    value = COALESCE(
      (
        SELECT SUM(item.quantity * item.unit_price)
        FROM public.deal_items AS item
        WHERE item.account_id = target_account_id
          AND item.deal_id = target_deal_id
      ),
      0
    ),
    updated_at = NOW()
  WHERE account_id = target_account_id
    AND id = target_deal_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER deal_items_sync_deal_value
  AFTER INSERT OR UPDATE OR DELETE ON deal_items
  FOR EACH ROW EXECUTE FUNCTION sync_deal_value_from_items();

REVOKE ALL ON FUNCTION sync_deal_value_from_items() FROM PUBLIC;

-- Agents can still update ordinary deal fields directly (for example stage
-- drag-and-drop). Prevent those broad table privileges from overwriting a
-- value that is already owned by line items, while legacy itemless deals keep
-- their historical/manual value behavior.
CREATE FUNCTION enforce_deal_item_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  derived_value NUMERIC;
BEGIN
  SELECT SUM(item.quantity * item.unit_price)
  INTO derived_value
  FROM public.deal_items AS item
  WHERE item.account_id = NEW.account_id
    AND item.deal_id = NEW.id;

  IF derived_value IS NOT NULL THEN
    NEW.value := derived_value;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER deals_enforce_item_value
  BEFORE UPDATE OF value ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_deal_item_value();

REVOKE ALL ON FUNCTION enforce_deal_item_value() FROM PUBLIC;

-- ============================================================
-- Authenticated manual create/update.
-- p_payload:
-- {
--   deal_id?: uuid,
--   pipeline_id: uuid,
--   stage_id: uuid,
--   contact_id: uuid,
--   title: text,
--   currency: text,
--   assigned_to?: uuid,
--   notes?: text,
--   expected_close_date?: date,
--   items: [{ product_id, quantity, unit_price, position }]
-- }
-- ============================================================

CREATE FUNCTION save_deal_with_items(p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  target_deal_id UUID;
  target_pipeline_id UUID;
  target_stage_id UUID;
  target_contact_id UUID;
  target_assignee_id UUID;
  target_account_id UUID;
  target_title TEXT;
  target_currency TEXT;
  target_notes TEXT;
  target_expected_close_date DATE;
  item_count INTEGER;
  distinct_product_count INTEGER;
  invalid_product_count INTEGER;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be an object' USING ERRCODE = '22023';
  END IF;

  target_deal_id := NULLIF(p_payload->>'deal_id', '')::UUID;
  target_pipeline_id := NULLIF(p_payload->>'pipeline_id', '')::UUID;
  target_stage_id := NULLIF(p_payload->>'stage_id', '')::UUID;
  target_contact_id := NULLIF(p_payload->>'contact_id', '')::UUID;
  target_assignee_id := NULLIF(p_payload->>'assigned_to', '')::UUID;
  target_title := btrim(COALESCE(p_payload->>'title', ''));
  target_currency := upper(btrim(COALESCE(p_payload->>'currency', '')));
  target_notes := NULLIF(btrim(COALESCE(p_payload->>'notes', '')), '');
  target_expected_close_date :=
    NULLIF(p_payload->>'expected_close_date', '')::DATE;

  IF target_pipeline_id IS NULL
    OR target_stage_id IS NULL
    OR target_contact_id IS NULL
    OR target_title = ''
    OR target_currency !~ '^[A-Z]{3}$'
  THEN
    RAISE EXCEPTION 'invalid deal fields' USING ERRCODE = '22023';
  END IF;

  SELECT pipeline.account_id
  INTO target_account_id
  FROM public.pipelines AS pipeline
  INNER JOIN public.pipeline_stages AS stage
    ON stage.pipeline_id = pipeline.id
  WHERE pipeline.id = target_pipeline_id
    AND stage.id = target_stage_id;

  IF target_account_id IS NULL
    OR NOT public.is_account_member(target_account_id, 'agent')
  THEN
    RAISE EXCEPTION 'pipeline not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contacts AS contact
    WHERE contact.id = target_contact_id
      AND contact.account_id = target_account_id
  ) THEN
    RAISE EXCEPTION 'contact is not in this account' USING ERRCODE = '23503';
  END IF;

  IF target_assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = target_assignee_id
      AND profile.account_id = target_account_id
  ) THEN
    RAISE EXCEPTION 'assignee is not in this account' USING ERRCODE = '23503';
  END IF;

  IF jsonb_typeof(p_payload->'items') <> 'array'
    OR jsonb_array_length(p_payload->'items') = 0
  THEN
    RAISE EXCEPTION 'at least one deal item is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COUNT(*),
    COUNT(DISTINCT NULLIF(item->>'product_id', '')::UUID)
  INTO item_count, distinct_product_count
  FROM jsonb_array_elements(p_payload->'items') AS item;

  IF item_count <> distinct_product_count THEN
    RAISE EXCEPTION 'deal products must be unique' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload->'items') AS item
    WHERE NULLIF(item->>'product_id', '') IS NULL
      OR NULLIF(item->>'quantity', '') IS NULL
      OR NULLIF(item->>'unit_price', '') IS NULL
      OR (item->>'quantity')::NUMERIC <= 0
      OR (item->>'unit_price')::NUMERIC < 0
  ) THEN
    RAISE EXCEPTION 'invalid deal item' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO invalid_product_count
  FROM jsonb_array_elements(p_payload->'items') AS item
  LEFT JOIN public.products AS product
    ON product.id = (item->>'product_id')::UUID
   AND product.account_id = target_account_id
  WHERE product.id IS NULL
    OR (
      NOT product.is_active
      AND (
        target_deal_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.deal_items AS existing_item
          WHERE existing_item.account_id = target_account_id
            AND existing_item.deal_id = target_deal_id
            AND existing_item.product_id = product.id
        )
      )
    );

  IF invalid_product_count > 0 THEN
    RAISE EXCEPTION 'product is unavailable for this deal'
      USING ERRCODE = '23503';
  END IF;

  IF target_deal_id IS NULL THEN
    INSERT INTO public.deals (
      user_id,
      account_id,
      pipeline_id,
      stage_id,
      contact_id,
      assigned_to,
      title,
      value,
      currency,
      notes,
      expected_close_date,
      status
    )
    VALUES (
      actor_id,
      target_account_id,
      target_pipeline_id,
      target_stage_id,
      target_contact_id,
      target_assignee_id,
      target_title,
      0,
      target_currency,
      target_notes,
      target_expected_close_date,
      'open'
    )
    RETURNING id INTO target_deal_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.deals AS deal
      WHERE deal.id = target_deal_id
        AND deal.account_id = target_account_id
    ) THEN
      RAISE EXCEPTION 'deal is not in this account' USING ERRCODE = '42501';
    END IF;

    UPDATE public.deals
    SET
      pipeline_id = target_pipeline_id,
      stage_id = target_stage_id,
      contact_id = target_contact_id,
      assigned_to = target_assignee_id,
      title = target_title,
      currency = target_currency,
      notes = target_notes,
      expected_close_date = target_expected_close_date,
      updated_at = NOW()
    WHERE id = target_deal_id
      AND account_id = target_account_id;

    DELETE FROM public.deal_items
    WHERE deal_id = target_deal_id
      AND account_id = target_account_id;
  END IF;

  INSERT INTO public.deal_items (
    account_id,
    deal_id,
    product_id,
    quantity,
    unit_price,
    position
  )
  SELECT
    target_account_id,
    target_deal_id,
    (item.value->>'product_id')::UUID,
    (item.value->>'quantity')::NUMERIC,
    (item.value->>'unit_price')::NUMERIC,
    (item.ordinality - 1)::INTEGER
  FROM jsonb_array_elements(p_payload->'items')
    WITH ORDINALITY AS item(value, ordinality);

  RETURN target_deal_id;
END;
$$;

REVOKE ALL ON FUNCTION save_deal_with_items(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_deal_with_items(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION save_deal_with_items(JSONB) TO authenticated;

-- ============================================================
-- Service-role-only automation create.
-- Existing productless automations intentionally keep their legacy
-- direct-insert path; this RPC is for the new `items[]` format.
-- ============================================================

CREATE FUNCTION create_automated_deal_with_items(p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_deal_id UUID;
  target_account_id UUID := NULLIF(p_payload->>'account_id', '')::UUID;
  target_user_id UUID := NULLIF(p_payload->>'user_id', '')::UUID;
  target_pipeline_id UUID := NULLIF(p_payload->>'pipeline_id', '')::UUID;
  target_stage_id UUID := NULLIF(p_payload->>'stage_id', '')::UUID;
  target_contact_id UUID := NULLIF(p_payload->>'contact_id', '')::UUID;
  target_title TEXT := btrim(COALESCE(p_payload->>'title', ''));
  target_currency TEXT := upper(btrim(COALESCE(p_payload->>'currency', '')));
  item_count INTEGER;
  distinct_product_count INTEGER;
BEGIN
  IF current_setting('request.jwt.claim.role', TRUE) <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF target_account_id IS NULL
    OR target_user_id IS NULL
    OR target_pipeline_id IS NULL
    OR target_stage_id IS NULL
    OR target_title = ''
    OR target_currency !~ '^[A-Z]{3}$'
    OR jsonb_typeof(p_payload->'items') <> 'array'
    OR jsonb_array_length(p_payload->'items') = 0
  THEN
    RAISE EXCEPTION 'invalid automated deal payload' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pipelines AS pipeline
    INNER JOIN public.pipeline_stages AS stage
      ON stage.pipeline_id = pipeline.id
    WHERE pipeline.id = target_pipeline_id
      AND pipeline.account_id = target_account_id
      AND stage.id = target_stage_id
  ) OR (
    target_contact_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.contacts AS contact
      WHERE contact.id = target_contact_id
        AND contact.account_id = target_account_id
    )
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = target_user_id
      AND profile.account_id = target_account_id
  ) THEN
    RAISE EXCEPTION 'automated deal resources are outside the account'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    COUNT(*),
    COUNT(DISTINCT NULLIF(item->>'product_id', '')::UUID)
  INTO item_count, distinct_product_count
  FROM jsonb_array_elements(p_payload->'items') AS item;

  IF item_count <> distinct_product_count OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload->'items') AS item
    LEFT JOIN public.products AS product
      ON product.id = NULLIF(item->>'product_id', '')::UUID
     AND product.account_id = target_account_id
     AND product.is_active
    WHERE product.id IS NULL
      OR NULLIF(item->>'quantity', '') IS NULL
      OR NULLIF(item->>'unit_price', '') IS NULL
      OR (item->>'quantity')::NUMERIC <= 0
      OR (item->>'unit_price')::NUMERIC < 0
  ) THEN
    RAISE EXCEPTION 'invalid automated deal items' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.deals (
    user_id,
    account_id,
    pipeline_id,
    stage_id,
    contact_id,
    title,
    value,
    currency,
    status
  )
  VALUES (
    target_user_id,
    target_account_id,
    target_pipeline_id,
    target_stage_id,
    target_contact_id,
    target_title,
    0,
    target_currency,
    'open'
  )
  RETURNING id INTO target_deal_id;

  INSERT INTO public.deal_items (
    account_id,
    deal_id,
    product_id,
    quantity,
    unit_price,
    position
  )
  SELECT
    target_account_id,
    target_deal_id,
    (item.value->>'product_id')::UUID,
    (item.value->>'quantity')::NUMERIC,
    (item.value->>'unit_price')::NUMERIC,
    (item.ordinality - 1)::INTEGER
  FROM jsonb_array_elements(p_payload->'items')
    WITH ORDINALITY AS item(value, ordinality);

  RETURN target_deal_id;
END;
$$;

REVOKE ALL ON FUNCTION create_automated_deal_with_items(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_automated_deal_with_items(JSONB) FROM anon;
REVOKE ALL ON FUNCTION create_automated_deal_with_items(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_automated_deal_with_items(JSONB) TO service_role;
