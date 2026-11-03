import { expect, test } from '@playwright/test'
import type { Step } from '../src/types'
import { validateBpmnProcess } from '../src/validation/validateBpmnProcess'

function makeStep(id: string, stepType: Step['stepType'], predecessorId = ''): Step {
  return {
    id,
    stepName: id,
    department: 'Operations',
    stepType,
    predecessorId,
    condition: '',
  }
}

test('reports missing starts, unlinked ends, and orphan steps', () => {
  const steps = [
    makeStep('end-a', 'End Event'),
    makeStep('end-b', 'End Event'),
    makeStep('orphan', 'Task'),
  ]

  const codes = validateBpmnProcess(steps).map((issue) => issue.code)
  expect(codes).toContain('missing-start-event')
  expect(codes).toContain('unlinked-end-events')
  expect(codes).toContain('orphan-steps')
})

test('requires outgoing decision paths to have a label or condition', () => {
  const gateway = makeStep('gateway', 'Exclusive Gateway')
  gateway.sequenceFlows = [
    { id: 'to-a', targetId: 'task-a', label: 'Approved' },
    { id: 'to-b', targetId: 'task-b' },
  ]
  const steps = [
    makeStep('start', 'Start Event'),
    gateway,
    makeStep('task-a', 'Task'),
    makeStep('task-b', 'Task'),
  ]

  const issue = validateBpmnProcess(steps).find(
    (candidate) => candidate.code === 'unlabeled-gateway-flow',
  )
  expect(issue?.stepIds).toContain('task-b')
})

test('warns about a cycle without an explicit exit condition', () => {
  const start = makeStep('start', 'Start Event')
  start.sequenceFlows = [{ id: 'start-to-a', targetId: 'a' }]
  const first = makeStep('a', 'Task')
  first.sequenceFlows = [{ id: 'a-to-b', targetId: 'b' }]
  const second = makeStep('b', 'Task')
  const exitFlow: NonNullable<Step['sequenceFlows']>[number] = {
    id: 'b-to-end',
    targetId: 'end',
  }
  second.sequenceFlows = [
    { id: 'b-to-a', targetId: 'a' },
    exitFlow,
  ]
  const steps = [start, first, second, makeStep('end', 'End Event')]

  expect(validateBpmnProcess(steps).map((issue) => issue.code))
    .toContain('cycle-without-exit')

  exitFlow.conditionExpression = '${shouldFinish}'
  expect(validateBpmnProcess(steps).map((issue) => issue.code))
    .not.toContain('cycle-without-exit')
})
