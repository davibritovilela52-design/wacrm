import type { BuilderStepInput } from './steps-tree'

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function productlessDealConfigsByPath(
  steps: BuilderStepInput[],
  prefix = ''
): Map<string, string> {
  const configs = new Map<string, string>()

  steps.forEach((step, index) => {
    const path = `${prefix}steps[${index}]`
    const items = step.step_config?.items
    if (
      step.step_type === 'create_deal' &&
      (!Array.isArray(items) || items.length === 0)
    ) {
      configs.set(path, canonicalJson(step.step_config ?? {}))
    }
    if (step.step_type === 'condition' && step.branches) {
      if (step.branches.yes) {
        for (const [childPath, config] of productlessDealConfigsByPath(
          step.branches.yes,
          `${path}.yes.`
        )) {
          configs.set(childPath, config)
        }
      }
      if (step.branches.no) {
        for (const [childPath, config] of productlessDealConfigsByPath(
          step.branches.no,
          `${path}.no.`
        )) {
          configs.set(childPath, config)
        }
      }
    }
  })

  return configs
}

export function createLegacyProductlessDealGuard(
  existingSteps: BuilderStepInput[]
): (config: Record<string, unknown>, path: string) => boolean {
  const legacyConfigs = productlessDealConfigsByPath(existingSteps)
  return (config, path) =>
    legacyConfigs.get(path) === canonicalJson(config)
}
