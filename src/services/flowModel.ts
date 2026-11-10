import type { Lane, Step } from '../types'

export type Link = { id: string; from: string; to: string; label?: string }

export type FlowModel = { schemaVersion: 2; steps: Step[]; links: Link[] }

export function fromFlowModel(model: FlowModel): { steps: Step[] } {
  const steps = model.steps.map((step) => {
    const copy = { ...step, predecessorId: '', condition: '' }
    delete copy.sequenceFlows
    return copy
  })
  const stepsById = new Map(steps.map((step) => [step.id, step]))
  const incomingAssigned = new Set<string>()

  for (const link of model.links) {
    const target = stepsById.get(link.to)
    if (!target) continue

    if (!incomingAssigned.has(link.to)) {
      target.predecessorId = link.from
      target.condition = link.label ?? ''
      incomingAssigned.add(link.to)
      continue
    }

    const source = stepsById.get(link.from)
    if (!source) continue
    source.sequenceFlows = [
      ...(source.sequenceFlows ?? []),
      { id: link.id, targetId: link.to, label: link.label },
    ]
  }

  return { steps }
}

export function toFlowModel(record: {
  steps: Step[]
  lanes?: Lane[]
}): { model: FlowModel; warnings: string[] } {
  const stepIds = new Set(record.steps.map((step) => step.id))
  const steps = record.steps.map((step) => ({
    ...step,
    ...(step.sequenceFlows
      ? { sequenceFlows: step.sequenceFlows.map((flow) => ({ ...flow })) }
      : {}),
  }))
  const linksByPair = new Map<string, Link>()
  const warnings: string[] = []

  function addLink(from: string, to: string, label?: string): void {
    const key = JSON.stringify([from, to])
    const id = `${from}>${to}`
    const existing = linksByPair.get(key)
    if (!existing || (!existing.label && label)) {
      linksByPair.set(key, { id, from, to, ...(label ? { label } : {}) })
    }
  }

  for (const step of record.steps) {
    if (step.predecessorId) {
      if (stepIds.has(step.predecessorId)) {
        addLink(step.predecessorId, step.id, step.condition || undefined)
      } else {
        warnings.push(
          `Step "${step.id}" references missing predecessor "${step.predecessorId}".`,
        )
      }
    }

    for (const flow of step.sequenceFlows ?? []) {
      if (stepIds.has(flow.targetId)) {
        addLink(step.id, flow.targetId, flow.label)
      } else {
        warnings.push(
          `Step "${step.id}" has a sequence flow to missing target "${flow.targetId}".`,
        )
      }
    }
  }

  return {
    model: { schemaVersion: 2, steps, links: [...linksByPair.values()] },
    warnings,
  }
}
