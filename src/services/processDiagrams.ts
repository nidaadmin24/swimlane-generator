import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProcessDiagram, SequenceFlow, Step } from '../types'

const DEFAULT_FOLDER = 'General'

const allowedStepTypes = new Set([
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

const diagramFields = 'id, title, folder, owner, lanes, steps, user_id, created_at'

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

export function isStepList(value: unknown): value is Step[] {
  return Array.isArray(value) && value.every((step) =>
    typeof step === 'object' &&
    step !== null &&
    typeof step.id === 'string' &&
    typeof step.stepName === 'string' &&
    typeof step.department === 'string' &&
    typeof step.stepType === 'string' &&
    allowedStepTypes.has(step.stepType) &&
    typeof step.predecessorId === 'string' &&
    typeof step.condition === 'string' &&
    (step.poolId === undefined || typeof step.poolId === 'string') &&
    (step.poolName === undefined || typeof step.poolName === 'string') &&
    (step.laneId === undefined || typeof step.laneId === 'string') &&
    (step.laneName === undefined || typeof step.laneName === 'string') &&
    (step.sequenceFlows === undefined ||
      (Array.isArray(step.sequenceFlows) && step.sequenceFlows.every(isSequenceFlow))) &&
    (step.goesBackTo === undefined ||
      (Array.isArray(step.goesBackTo) &&
        step.goesBackTo.every((targetId: unknown) => typeof targetId === 'string'))),
  )
}

function normaliseFolder(folder: string | null | undefined): string {
  const trimmed = folder?.trim()
  return trimmed ? trimmed : DEFAULT_FOLDER
}

export async function fetchProcessDiagrams(
  client: SupabaseClient,
): Promise<ProcessDiagram[]> {
  const { data, error } = await client
    .from('process_diagrams')
    .select(diagramFields)
    .order('folder', { ascending: true })
    .order('title', { ascending: true })

  if (error) throw error

  const diagrams = (data ?? []) as ProcessDiagram[]
  return diagrams.map((diagram) => {
    if (!isStepList(diagram.steps)) {
      throw new Error(`Saved flowchart "${diagram.title}" has invalid step data.`)
    }
    return {
      ...diagram,
      steps: diagram.steps.map((step) => ({ ...step, goesBackTo: step.goesBackTo ?? [] })),
    }
  })
}

export async function saveProcessDiagram(
  client: SupabaseClient,
  diagram: Pick<ProcessDiagram, 'title' | 'steps' | 'folder' | 'owner' | 'lanes'>,
  options: { id: string | null; asNew: boolean },
): Promise<ProcessDiagram> {
  const folder = normaliseFolder(diagram.folder)

  const payload = {
    title: diagram.title,
    steps: diagram.steps,
    folder,
    owner: diagram.owner?.trim() || null,
    lanes: diagram.lanes,
  }

  let query

  if (options.id && !options.asNew) {
    // Updates are checked by the "manage their own" policy, so user_id is not needed here.
    query = client
      .from('process_diagrams')
      .update(payload)
      .eq('id', options.id)
  } else {
    // New rows must be owned by the signed-in user, or the owner policy blocks them.
    const { data: userData, error: userError } = await client.auth.getUser()
    if (userError) throw userError

    const userId = userData.user?.id
    if (!userId) throw new Error('You must be signed in to save a flowchart.')

    query = client
      .from('process_diagrams')
      .insert({ ...payload, user_id: userId })
  }

  const { data, error } = await query.select(diagramFields).single()
  if (error) throw error

  const saved = data as ProcessDiagram
  if (!isStepList(saved.steps)) {
    throw new Error(`Saved flowchart "${saved.title}" has invalid step data.`)
  }

  return {
    ...saved,
    steps: saved.steps.map((step) => ({ ...step, goesBackTo: step.goesBackTo ?? [] })),
  }
}

export async function deleteProcessDiagram(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from('process_diagrams')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function moveProcessDiagramToFolder(
  client: SupabaseClient,
  id: string,
  folder: string,
): Promise<void> {
  const { error } = await client
    .from('process_diagrams')
    .update({ folder: normaliseFolder(folder) })
    .eq('id', id)

  if (error) throw error
}