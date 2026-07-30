import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/046_pipeline_products_and_deal_items.sql'
  ),
  'utf8'
);

describe('pipeline product migration contract', () => {
  it('creates tenant-scoped products and deal items with integrity constraints', () => {
    expect(migration).toMatch(/CREATE TABLE products/i);
    expect(migration).toMatch(/CREATE TABLE deal_items/i);
    expect(migration).toMatch(/UNIQUE \(account_id, deal_id, product_id\)/i);
    expect(migration).toMatch(/CHECK \(quantity > 0\)/i);
    expect(migration).toMatch(/CHECK \(unit_price >= 0\)/i);
    expect(migration).toMatch(/FOREIGN KEY \(account_id, deal_id\)/i);
    expect(migration).toMatch(/FOREIGN KEY \(account_id, product_id\)/i);
  });

  it('enforces case-insensitive product identity per account', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX products_account_name_unique[\s\S]*lower\(name\)/i
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX products_account_code_unique[\s\S]*lower\(code\)[\s\S]*WHERE code IS NOT NULL/i
    );
  });

  it('keeps deal totals synchronized and exposes atomic RPCs', () => {
    expect(migration).toMatch(/CREATE FUNCTION sync_deal_value_from_items/i);
    expect(migration).toMatch(/CREATE TRIGGER deal_items_sync_deal_value/i);
    expect(migration).toMatch(/CREATE FUNCTION enforce_deal_item_value/i);
    expect(migration).toMatch(/BEFORE UPDATE OF value ON deals/i);
    expect(migration).toMatch(/CREATE FUNCTION save_deal_with_items/i);
    expect(migration).toMatch(
      /CREATE FUNCTION create_automated_deal_with_items/i
    );
  });

  it('applies least-privilege RLS and function grants', () => {
    expect(migration).toMatch(
      /ALTER TABLE products ENABLE ROW LEVEL SECURITY/i
    );
    expect(migration).toMatch(
      /ALTER TABLE deal_items ENABLE ROW LEVEL SECURITY/i
    );
    expect(migration).toMatch(/CREATE POLICY products_select/i);
    expect(migration).toMatch(/CREATE POLICY products_insert/i);
    expect(migration).toMatch(/CREATE POLICY deal_items_select/i);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION save_deal_with_items\(JSONB\) FROM PUBLIC/i
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION save_deal_with_items\(JSONB\) TO authenticated/i
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION create_automated_deal_with_items\(JSONB\) TO service_role/i
    );
  });

  it('validates the automation author using the auth user key', () => {
    expect(migration).toMatch(
      /FROM public\.profiles AS profile[\s\S]*profile\.user_id = target_user_id[\s\S]*profile\.account_id = target_account_id/i
    );
  });

  it('allows service-role automations without a contact and validates one when present', () => {
    const serviceRpc = migration.slice(
      migration.indexOf('CREATE FUNCTION create_automated_deal_with_items'),
      migration.indexOf(
        'REVOKE ALL ON FUNCTION create_automated_deal_with_items'
      )
    );
    expect(serviceRpc).not.toMatch(
      /target_contact_id IS NULL[\s\S]*invalid automated deal payload/i
    );
    expect(serviceRpc).toMatch(
      /target_contact_id IS NOT NULL[\s\S]*FROM public\.contacts AS contact/i
    );
  });
});
