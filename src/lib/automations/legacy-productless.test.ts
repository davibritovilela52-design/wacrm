import { describe, expect, it } from 'vitest'

import { createLegacyProductlessDealGuard } from './legacy-productless'

const legacyConfig = {
  pipeline_id: 'pipeline-1',
  stage_id: 'stage-1',
  title: 'Legacy deal',
  value: 100,
}

describe('legacy productless automation guard', () => {
  it('grandfathers only the unchanged step at its existing path', () => {
    const guard = createLegacyProductlessDealGuard([
      { step_type: 'create_deal', step_config: legacyConfig },
    ])

    expect(guard({ ...legacyConfig }, 'steps[0]')).toBe(true)
    expect(
      guard({ ...legacyConfig, title: 'Modified deal' }, 'steps[0]')
    ).toBe(false)
    expect(guard({ ...legacyConfig }, 'steps[1]')).toBe(false)
  })

  it('does not grandfather an itemized existing step', () => {
    const guard = createLegacyProductlessDealGuard([
      {
        step_type: 'create_deal',
        step_config: {
          ...legacyConfig,
          items: [{ product_id: 'product-1', quantity: 1, unit_price: 100 }],
        },
      },
    ])

    expect(guard(legacyConfig, 'steps[0]')).toBe(false)
  })
})
