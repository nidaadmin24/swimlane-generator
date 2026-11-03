import type { SequenceFlow, Step } from '../types'

export interface BpmnValidationIssue {
  code: string
  message: string
  stepIds: string[]
}

interface ResolvedFlow extends SequenceFlow {
  sourceId: string
}

function isStartEvent(step: Step): boolean {
  return step.stepType === 'Start Event'
}

function isEndEvent(step: Step): boolean {
  return step.stepType === 'End Event'
}

function isDecisionGateway(step: Step): boolean {
  return step.stepType === 'Decision Point' || step.stepType === 'Exclusive Gateway'
}

function getFlows(steps: Step[]): ResolvedFlow[] {
  const stepsById = new Map(steps.map((step) => [step.id, step]))
  const flows = steps.flatMap((step) =>
    (step.sequenceFlows ?? [])
      .filter((flow) => stepsById.has(flow.targetId))
      .map((flow) => ({ ...flow, sourceId: step.id })),
  )
  const existingConnections = new Set(
    flows.map((flow) => `${flow.sourceId}\u0000${flow.targetId}`),
  )

  steps.forEach((target) => {
    const source = stepsById.get(target.predecessorId)
    if (!source) return

    const connection = `${source.id}\u0000${target.id}`
    if (existingConnections.has(connection)) return

    flows.push({
      id: `legacy-${source.id}-${target.id}`,
      sourceId: source.id,
      targetId: target.id,
      label: target.condition,
    })
    existingConnections.add(connection)
  })

  return flows
}

function getCyclicComponents(
  stepIds: string[],
  flows: ResolvedFlow[],
): string[][] {
  const adjacency = new Map(stepIds.map((id) => [id, [] as string[]]))
  const reverseAdjacency = new Map(stepIds.map((id) => [id, [] as string[]]))
  flows.forEach((flow) => {
    adjacency.get(flow.sourceId)?.push(flow.targetId)
    reverseAdjacency.get(flow.targetId)?.push(flow.sourceId)
  })

  const visited = new Set<string>()
  const finishOrder: string[] = []
  stepIds.forEach((root) => {
    if (visited.has(root)) return
    const stack: Array<{ id: string; exiting: boolean }> = [{ id: root, exiting: false }]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.exiting) {
        finishOrder.push(current.id)
        continue
      }
      if (visited.has(current.id)) continue
      visited.add(current.id)
      stack.push({ id: current.id, exiting: true })
      for (const neighbor of adjacency.get(current.id) ?? []) {
        if (!visited.has(neighbor)) stack.push({ id: neighbor, exiting: false })
      }
    }
  })

  visited.clear()
  const cyclicComponents: string[][] = []
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const root = finishOrder[index]
    if (visited.has(root)) continue
    const component: string[] = []
    const stack = [root]
    visited.add(root)
    while (stack.length > 0) {
      const current = stack.pop()!
      component.push(current)
      for (const neighbor of reverseAdjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          stack.push(neighbor)
        }
      }
    }
    const hasSelfLoop = (adjacency.get(root) ?? []).includes(root)
    if (component.length > 1 || hasSelfLoop) cyclicComponents.push(component)
  }
  return cyclicComponents
}

export function validateBpmnProcess(steps: Step[]): BpmnValidationIssue[] {
  const issues: BpmnValidationIssue[] = []
  const flows = getFlows(steps)
  const outgoingById = new Map(steps.map((step) => [step.id, [] as ResolvedFlow[]]))
  const incomingById = new Map(steps.map((step) => [step.id, [] as ResolvedFlow[]]))

  flows.forEach((flow) => {
    outgoingById.get(flow.sourceId)?.push(flow)
    incomingById.get(flow.targetId)?.push(flow)
  })

  const starts = steps.filter(isStartEvent)
  if (starts.length === 0) {
    issues.push({
      code: 'missing-start-event',
      message: 'Add a Start Event to define where this process begins.',
      stepIds: [],
    })
  }

  const unlinkedEnds = steps.filter(
    (step) => isEndEvent(step) && (incomingById.get(step.id)?.length ?? 0) === 0,
  )
  if (unlinkedEnds.length > 1) {
    issues.push({
      code: 'unlinked-end-events',
      message: `${unlinkedEnds.length} End Events are not connected to an incoming sequence flow.`,
      stepIds: unlinkedEnds.map((step) => step.id),
    })
  }

  steps.filter(isDecisionGateway).forEach((gateway) => {
    const outgoing = outgoingById.get(gateway.id) ?? []
    if (outgoing.length === 0) {
      issues.push({
        code: 'gateway-without-outgoing-flow',
        message: `Decision gateway "${gateway.stepName || gateway.id}" has no outgoing sequence flows.`,
        stepIds: [gateway.id],
      })
      return
    }

    const legacyConditions = gateway.condition
      .split(/\s*(?:\/|\||,|\band\b)\s*/i)
      .map((condition) => condition.trim())
      .filter(Boolean)
    const unlabeled = outgoing.filter((flow, index) => {
      if (flow.isDefault || flow.label?.trim() || flow.conditionExpression?.trim()) {
        return false
      }
      return !legacyConditions[index]
    })
    if (unlabeled.length > 0) {
      issues.push({
        code: 'unlabeled-gateway-flow',
        message: `Add a label or condition expression to each outgoing flow from "${gateway.stepName || gateway.id}", or mark a default flow.`,
        stepIds: [gateway.id, ...unlabeled.map((flow) => flow.targetId)],
      })
    }
  })

  const orphans = steps.filter(
    (step) =>
      !isStartEvent(step) &&
      !isEndEvent(step) &&
      (incomingById.get(step.id)?.length ?? 0) === 0 &&
      (outgoingById.get(step.id)?.length ?? 0) === 0,
  )
  if (orphans.length > 0) {
    issues.push({
      code: 'orphan-steps',
      message: `${orphans.length} step${orphans.length === 1 ? '' : 's'} have no connected sequence flows.`,
      stepIds: orphans.map((step) => step.id),
    })
  }

  if (starts.length > 0) {
    const reachable = new Set<string>()
    const pending = starts.map((step) => step.id)
    while (pending.length > 0) {
      const stepId = pending.pop()!
      if (reachable.has(stepId)) continue
      reachable.add(stepId)
      for (const flow of outgoingById.get(stepId) ?? []) {
        pending.push(flow.targetId)
      }
    }

    const unreachable = steps.filter((step) => !reachable.has(step.id))
    if (unreachable.length > 0) {
      issues.push({
        code: 'unreachable-steps',
        message: `${unreachable.length} step${unreachable.length === 1 ? '' : 's'} cannot be reached from a Start Event.`,
        stepIds: unreachable.map((step) => step.id),
      })
    }
  }

  getCyclicComponents(steps.map((step) => step.id), flows).forEach((component) => {
    const componentIds = new Set(component)
    const exits = component.flatMap((stepId) =>
      outgoingById.get(stepId) ?? [],
    ).filter((flow) => !componentIds.has(flow.targetId))
    const hasDefinedExit = exits.some(
      (flow) => flow.isDefault || flow.label?.trim() || flow.conditionExpression?.trim(),
    )
    if (!hasDefinedExit) {
      issues.push({
        code: 'cycle-without-exit',
        message: 'A sequence-flow cycle has no labeled, conditional, or default exit.',
        stepIds: component,
      })
    }
  })

  return issues
}
