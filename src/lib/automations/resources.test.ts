import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAutomationResources } from './resources'

function fakeSupabase(data: {
  tags: { id: string; name: string }[]
  pipelines: { id: string; name: string }[]
  stages: { id: string; name: string; pipeline_id: string }[]
  products?: {
    id: string
    name: string
    default_unit_price: number
    currency: string
  }[]
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'tags') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: data.tags, error: null }),
          }),
        }
      }
      if (table === 'pipelines') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: data.pipelines, error: null }),
          }),
        }
      }
      if (table === 'pipeline_stages') {
        return {
          select: () => ({
            in: (_column: string, pipelineIds: string[]) => ({
              order: () =>
                Promise.resolve({
                  data: data.stages.filter((s) =>
                    pipelineIds.includes(s.pipeline_id)
                  ),
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === 'products') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({ data: data.products ?? [], error: null }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as unknown as SupabaseClient
}

describe('loadAutomationResources', () => {
  it('groups stages under their pipeline', async () => {
    const supabase = fakeSupabase({
      tags: [{ id: 't1', name: 'VIP' }],
      pipelines: [{ id: 'p1', name: 'Sales' }],
      stages: [
        { id: 's1', name: 'New', pipeline_id: 'p1' },
        { id: 's2', name: 'Won', pipeline_id: 'p1' },
      ],
      products: [
        {
          id: 'product-1',
          name: 'CRM',
          default_unit_price: 100,
          currency: 'BRL',
        },
      ],
    })
    const result = await loadAutomationResources(supabase, 'acct-1')
    expect(result.tags).toEqual([{ id: 't1', name: 'VIP' }])
    expect(result.pipelines).toEqual([
      {
        id: 'p1',
        name: 'Sales',
        stages: [
          { id: 's1', name: 'New' },
          { id: 's2', name: 'Won' },
        ],
      },
    ])
    expect(result.products).toEqual([
      {
        id: 'product-1',
        name: 'CRM',
        default_unit_price: 100,
        currency: 'BRL',
      },
    ])
  })

  it('returns empty arrays when nothing is configured', async () => {
    const supabase = fakeSupabase({ tags: [], pipelines: [], stages: [] })
    const result = await loadAutomationResources(supabase, 'acct-1')
    expect(result).toEqual({ tags: [], pipelines: [], products: [] })
  })

  it('throws when Supabase returns an error instead of silently returning empty', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'tags') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: null,
                  error: { message: 'connection timeout' },
                }),
            }),
          }
        }
        if (table === 'pipelines') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }
        if (table === 'pipeline_stages') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    } as unknown as SupabaseClient

    await expect(loadAutomationResources(supabase, 'acct-1')).rejects.toThrow(
      'Failed to load tags: connection timeout'
    )
  })

  it("scopes pipeline_stages to the account's own pipeline ids and throws on stage-fetch failure", async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'tags') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }
        if (table === 'pipelines') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ id: 'p1', name: 'Sales' }],
                  error: null,
                }),
            }),
          }
        }
        if (table === 'pipeline_stages') {
          return {
            select: () => ({
              in: () => ({
                order: () =>
                  Promise.resolve({
                    data: null,
                    error: { message: 'db unavailable' },
                  }),
              }),
            }),
          }
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    } as unknown as SupabaseClient

    await expect(loadAutomationResources(supabase, 'acct-1')).rejects.toThrow(
      'Failed to load pipeline_stages: db unavailable'
    )
  })

  it('does not query pipeline_stages when the account has no pipelines', async () => {
    let stagesQueried = false
    const supabase = {
      from: (table: string) => {
        if (table === 'tags') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }
        if (table === 'pipelines') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }
        if (table === 'pipeline_stages') {
          stagesQueried = true
          return {
            select: () => ({
              in: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    } as unknown as SupabaseClient

    const result = await loadAutomationResources(supabase, 'acct-1')
    expect(result).toEqual({ tags: [], pipelines: [], products: [] })
    expect(stagesQueried).toBe(false)
  })
})
