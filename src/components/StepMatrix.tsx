import { memo, useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Plus, Trash2, Workflow } from 'lucide-react'
import type { Step, StepType } from '../types'

const stepTypes = [
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
] as const satisfies readonly StepType[]

type StepField = keyof Step

interface StepRowProps {
  step: Step
  stepIds: string[]
  onUpdate: (stepId: string, field: StepField, value: string) => void
  onDelete: (stepId: string) => void
}

interface StepMatrixProps {
  steps: Step[]
  onStepsChange: Dispatch<SetStateAction<Step[]>>
  onGenerate?: (steps: Step[]) => void
}

const textFields = [
  { key: 'id', label: 'Step ID' },
  { key: 'stepName', label: 'Step name' },
  { key: 'department', label: 'Department' },
  { key: 'condition', label: 'Condition' },
] satisfies { key: StepField; label: string }[]

function getNextStepId(steps: Step[]): string {
  const highestId = steps.reduce((highest, step) => {
    const number = Number(step.id.match(/^STEP-(\d+)$/)?.[1] ?? 0)
    return Math.max(highest, number)
  }, 0)

  return `STEP-${String(highestId + 1).padStart(3, '0')}`
}

const StepRow = memo(function StepRow({ step, stepIds, onUpdate, onDelete }: StepRowProps) {
  return (
    <tr className="group transition-colors hover:bg-slate-50/80">
      {textFields.slice(0, 3).map(({ key, label }) => (
        <td key={key} className="px-3 py-2">
          <input
            aria-label={`${label} for ${step.id}`}
            type="text"
            value={step[key]}
            onChange={(event) => onUpdate(step.id, key, event.target.value)}
            className={`w-full rounded border border-transparent bg-transparent px-2 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100 ${key === 'id' ? 'font-mono text-xs text-slate-500' : ''}`}
          />
        </td>
      ))}
      <td className="px-3 py-2">
        <select
          aria-label={`Step type for ${step.id}`}
          value={step.stepType}
          onChange={(event) => onUpdate(step.id, 'stepType', event.target.value)}
          className="w-full rounded border border-transparent bg-transparent px-2 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100"
        >
          {stepTypes.map((stepType) => (
            <option key={stepType} value={stepType}>{stepType}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          aria-label={`Predecessor for ${step.id}`}
          value={step.predecessorId}
          onChange={(event) => onUpdate(step.id, 'predecessorId', event.target.value)}
          className="w-full rounded border border-transparent bg-transparent px-2 py-2 font-mono text-xs text-slate-700 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100"
        >
          <option value="">None</option>
          {stepIds
            .filter((stepId) => stepId !== step.id)
            .map((stepId) => (
              <option key={stepId} value={stepId}>{stepId}</option>
            ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          aria-label={`Condition for ${step.id}`}
          type="text"
          value={step.condition}
          onChange={(event) => onUpdate(step.id, 'condition', event.target.value)}
          placeholder="e.g. Yes or No"
          className="w-full rounded border border-transparent bg-transparent px-2 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <button
          type="button"
          aria-label={`Delete ${step.id}`}
          title="Delete row"
          onClick={() => onDelete(step.id)}
          className="inline-flex size-9 items-center justify-center rounded text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
        >
          <Trash2 aria-hidden="true" size={16} />
        </button>
      </td>
    </tr>
  )
})

function StepMatrix({ steps, onStepsChange, onGenerate }: StepMatrixProps) {
  const [generated, setGenerated] = useState(false)
  const stepIdsKey = JSON.stringify(steps.map((step) => step.id))
  const stepIds = useMemo(
    (): string[] => JSON.parse(stepIdsKey),
    [stepIdsKey],
  )

  const updateStep = useCallback((stepId: string, field: StepField, value: string) => {
    setGenerated(false)
    onStepsChange((currentSteps) => {
      if (field === 'id') {
        const nextId = value.trim()
        if (
          !nextId ||
          currentSteps.some((step) => step.id === nextId && step.id !== stepId)
        ) {
          return currentSteps
        }

        return currentSteps.map((step) => {
          if (step.id === stepId) return { ...step, id: nextId }
          if (step.predecessorId === stepId) {
            return { ...step, predecessorId: nextId }
          }
          return step
        })
      }

      if (field === 'stepType') {
        if (!stepTypes.includes(value as StepType)) return currentSteps
        return currentSteps.map((step) =>
          step.id === stepId ? { ...step, stepType: value as StepType } : step,
        )
      }

      return currentSteps.map((step) =>
        step.id === stepId ? { ...step, [field]: value } : step,
      )
    })
  }, [onStepsChange])

  const addStep = useCallback(() => {
    setGenerated(false)
    onStepsChange((currentSteps) => [
      ...currentSteps,
      {
        id: getNextStepId(currentSteps),
        stepName: '',
        department: '',
        stepType: 'Task',
        predecessorId: '',
        condition: '',
      },
    ])
  }, [onStepsChange])

  const deleteStep = useCallback((stepId: string) => {
    setGenerated(false)
    onStepsChange((currentSteps) =>
      currentSteps
        .filter((step) => step.id !== stepId)
        .map((step) =>
          step.predecessorId === stepId ? { ...step, predecessorId: '' } : step,
        ),
    )
  }, [onStepsChange])

  function generateFlowchart() {
    onGenerate?.(steps.map((step) => ({ ...step })))
    setGenerated(true)
  }

  return (
    <section className="w-full space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Process steps</h2>
          <p className="mt-1 text-sm text-slate-500">
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </p>
        </div>
        <button
          type="button"
          onClick={generateFlowchart}
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        >
          <Workflow aria-hidden="true" size={16} />
          Generate Flowchart
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="border-b border-slate-200 px-4 py-3">Step ID</th>
              <th scope="col" className="border-b border-slate-200 px-4 py-3">Step name</th>
              <th scope="col" className="border-b border-slate-200 px-4 py-3">Department</th>
              <th scope="col" className="border-b border-slate-200 px-4 py-3">Step type</th>
              <th scope="col" className="border-b border-slate-200 px-4 py-3">Predecessor</th>
              <th scope="col" className="border-b border-slate-200 px-4 py-3">Condition</th>
              <th scope="col" className="w-14 border-b border-slate-200 px-3 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {steps.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                stepIds={stepIds}
                onUpdate={updateStep}
                onDelete={deleteStep}
              />
            ))}
            {steps.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                  No process steps yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addStep}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        >
          <Plus aria-hidden="true" size={16} />
          Add Row
        </button>
        {generated && (
          <span role="status" className="text-sm text-emerald-700">
            Flowchart data generated from {steps.length} {steps.length === 1 ? 'step' : 'steps'}.
          </span>
        )}
      </div>
    </section>
  )
}

export default StepMatrix
