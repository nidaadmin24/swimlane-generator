import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, ProcessDiagram, SequenceFlow, Step } from '../types'

function isSequenceFlow(value: unknown): value is SequenceFlow {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('targetId' in value) ||
    typeof value.targetId !== 'string'
  ) {
    return false
  }

  const optionalFieldsAreValid =
    (!('label' in value) || value.label === undefined || typeof value.label === 'string') &&
    (!('conditionExpression' in value) ||
      value.conditionExpression === undefined ||
      typeof value.conditionExpression === 'string') &&
    (!('isDefault' in value) ||
      value.isDefault === undefined ||
      typeof value.isDefault === 'boolean')
  return optionalFieldsAreValid
}

export async function fetchProcessDiagrams(
  client: SupabaseClient<Database>,
): Promise<ProcessDiagram[]> {
  const { data, error } = await client
    .from('process_diagrams')
    .select('id, title, steps, user_id, created_at')
    .order('title', { ascending: true })

  if (error) throw error
  for (const diagram of data ?? []) {
    if (!isStepList(diagram.steps)) {
      throw new Error(`Saved flowchart "${diagram.title}" has invalid step data.`)
    }
  }
  return data ?? []
}

export async function saveProcessDiagram(
  client: SupabaseClient<Database>,
  diagram: Pick<ProcessDiagram, 'title' | 'steps'>,
  options: { id: string | null; asNew: boolean },
): Promise<ProcessDiagram> {
  const fields = 'id, title, steps, user_id, created_at'
  const query = options.id && !options.asNew
    ? client
        .from('process_diagrams')
        .update({ title: diagram.title, steps: diagram.steps })
        .eq('id', options.id)
    : client
        .from('process_diagrams')
        .insert({ title: diagram.title, steps: diagram.steps })

  const { data, error } = await query.select(fields).single()
  if (error) throw error
  if (!isStepList(data.steps)) {
    throw new Error(`Saved flowchart "${data.title}" has invalid step data.`)
  }
  return data
}

export async function deleteProcessDiagram(
  client: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { error } = await client
    .from('process_diagrams')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export function isStepList(value: unknown): value is Step[] {
  const allowedTypes = new Set([
    'Start Event',
    'Task',
    'User Task',
    'Service Task',
    'Manual Task',
    'Decision Point',
    'Exclusive Gateway',
    'Parallel Gateway',
    'End Event',
    'Data/Artifact',
  ])
  return Array.isArray(value) && value.every((step) =>
    typeof step === 'object' &&
    step !== null &&
    typeof step.id === 'string' &&
    typeof step.stepName === 'string' &&
    typeof step.department === 'string' &&
    typeof step.stepType === 'string' &&
    allowedTypes.has(step.stepType) &&
    typeof step.predecessorId === 'string' &&
    typeof step.condition === 'string' &&
    (step.poolId === undefined || typeof step.poolId === 'string') &&
    (step.poolName === undefined || typeof step.poolName === 'string') &&
    (step.laneId === undefined || typeof step.laneId === 'string') &&
    (step.laneName === undefined || typeof step.laneName === 'string') &&
    (step.sequenceFlows === undefined ||
      (Array.isArray(step.sequenceFlows) && step.sequenceFlows.every(isSequenceFlow))),
  )
}
