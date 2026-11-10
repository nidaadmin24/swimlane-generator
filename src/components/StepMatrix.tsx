import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { ArrowDown, ArrowUp, Download, Plus, Trash2, Upload, Workflow } from 'lucide-react'
import { fromFlowModel, toFlowModel } from '../services/flowModel'
import { parseStepsCsv } from '../services/stepsCsv'
import type { Link } from '../services/flowModel'
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

type StepWarning = { stepId: string; message: string }

function toCsvCell(value: string): string {
  const escaped = value.replace(/"/g, '""')
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped
}

function computeWarnings(steps: Step[], links: Link[]): StepWarning[] {
  const stepById = new Map(steps.map((step) => [step.id, step]))
  const incomingCounts = new Map<string, number>()
  const outgoingCounts = new Map<string, number>()
  const departmentCounts = new Map<string, number>()

  for (const link of links) {
    incomingCounts.set(link.to, (incomingCounts.get(link.to) ?? 0) + 1)
    if (link.from !== link.to) {
      outgoingCounts.set(link.from, (outgoingCounts.get(link.from) ?? 0) + 1)
    }
  }
  for (const step of steps) {
    const department = step.department.trim().toLocaleLowerCase()
    if (department) {
      departmentCounts.set(department, (departmentCounts.get(department) ?? 0) + 1)
    }
  }

  const warnings: StepWarning[] = []
  for (const step of steps) {
    const isDecision =
      step.stepType === 'Decision Point' || step.stepType === 'Exclusive Gateway'

    if (isDecision && (outgoingCounts.get(step.id) ?? 0) < 2) {
      warnings.push({
        stepId: step.id,
        message: 'Decision needs two outgoing branches (Yes and No).',
      })
    }
    if (
      links.some((link) => link.to === step.id && /^(yes|no)$/i.test(link.label ?? '') &&
        !['Decision Point', 'Exclusive Gateway'].includes(
          stepById.get(link.from)?.stepType ?? '',
        ))
    ) {
      warnings.push({
        stepId: step.id,
        message: 'Yes/No label is only used after a decision.',
      })
    }
    if (step.stepType !== 'Start Event' && !(incomingCounts.get(step.id) ?? 0)) {
      warnings.push({ stepId: step.id, message: 'No incoming step. Set a predecessor.' })
    }
    if (
      step.stepType !== 'End Event' &&
      step.stepType !== 'Decision Point' &&
      step.stepType !== 'Exclusive Gateway' &&
      (outgoingCounts.get(step.id) ?? 0) === 0
    ) {
      warnings.push({ stepId: step.id, message: 'Dead end. Nothing follows this step.' })
    }
    if (!step.stepName.trim()) {
      warnings.push({ stepId: step.id, message: 'Step name is empty.' })
    }
    const department = step.department.trim().toLocaleLowerCase()
    if (department && departmentCounts.get(department) === 1) {
      warnings.push({
        stepId: step.id,
        message: 'Department appears only once. Check for a typo.',
      })
    }
  }
  return warnings
}

interface StepRowProps {
  step: Step
  stepIds: string[]
  stepLabels: Map<string, string>
  incomingLinks: Link[]
  outgoingLinks: Link[]
  isDecision: boolean
  hasWarning: boolean
  onUpdate: (stepId: string, field: StepField, value: string) => void
  onAddLink: (from: string, to: string, label?: string) => void
  onRemoveLink: (from: string, to: string) => void
  onDelete: (stepId: string) => void
  onInsertBelow: (stepId: string) => void
  onMove: (stepId: string, direction: -1 | 1) => void
  isFirst: boolean
  isLast: boolean
}

interface StepMatrixProps {
  steps: Step[]
  links: Link[]
  onStepsChange: Dispatch<SetStateAction<Step[]>>
  onLinksChange: Dispatch<SetStateAction<Link[]>>
  onGenerate?: (steps: Step[]) => void
}

const columnWidths = ['110px', 'auto', '230px', '160px', '110px', '220px', '170px']

const inputClass =
  'w-full rounded border border-transparent bg-transparent px-2 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100'

function getNextStepId(steps: Step[]): string {
  const highestId = steps.reduce((highest, step) => {
    const number = Number(step.id.match(/^STEP-(\d+)$/)?.[1] ?? 0)
    return Math.max(highest, number)
  }, 0)
  return `STEP-${String(highestId + 1).padStart(3, '0')}`
}

/** Commits the ID on blur, so renaming does not remount the row on every keystroke. */
function StepIdInput({
  stepId,
  stepIds,
  onCommit,
}: {
  stepId: string
  stepIds: string[]
  onCommit: (nextId: string) => void
}) {
  const [draft, setDraft] = useState(stepId)
  const [syncedId, setSyncedId] = useState(stepId)
  if (syncedId !== stepId) {
    setSyncedId(stepId)
    setDraft(stepId)
  }

  function commit() {
    const next = draft.trim()
    if (!next || (next !== stepId && stepIds.includes(next))) {
      setDraft(stepId)
      return
    }
    if (next !== stepId) onCommit(next)
  }

  return (
    <input
      aria-label={`Step ID for ${stepId}`}
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(stepId)
      }}
      className={inputClass}
    />
  )
}

const StepRow = memo(function StepRow({
  step,
  stepIds,
  stepLabels,
  incomingLinks,
  outgoingLinks,
  isDecision,
  hasWarning,
  onUpdate,
  onAddLink,
  onRemoveLink,
  onDelete,
  onInsertBelow,
  onMove,
  isFirst,
  isLast,
}: StepRowProps) {
  const [nextTargetId, setNextTargetId] = useState('')
  const [nextLabel, setNextLabel] = useState('')

  return (
    <tr
      className={`group transition-colors hover:bg-slate-50/80 ${
        hasWarning ? 'border-l-4 border-amber-400 bg-amber-50/60' : ''
      }`}
    >
      <td className="px-3 py-2">
        <StepIdInput
          stepId={step.id}
          stepIds={stepIds}
          onCommit={(nextId) => onUpdate(step.id, 'id', nextId)}
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label={`Step name for ${step.id}`}
          type="text"
          value={step.stepName}
          onChange={(event) => onUpdate(step.id, 'stepName', event.target.value)}
          className={inputClass}
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label={`Department for ${step.id}`}
          type="text"
          list="department-options"
          value={step.department}
          onChange={(event) => onUpdate(step.id, 'department', event.target.value)}
          className={inputClass}
        />
      </td>
      <td className="px-3 py-2">
        <select
          aria-label={`Step type for ${step.id}`}
          value={step.stepType}
          onChange={(event) => onUpdate(step.id, 'stepType', event.target.value)}
          className={inputClass}
        >
          {stepTypes.map((stepType) => (
            <option key={stepType} value={stepType}>
              {stepType}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2 text-xs text-slate-600">
        {incomingLinks.length
          ? incomingLinks.map((link) =>
              `${link.from}${link.label ? ` [${link.label}]` : ''}`,
            ).join(', ')
          : '—'}
      </td>
      <td className="px-2 py-2">
        <div className="space-y-2">
          {outgoingLinks.map((link) => (
            <div key={JSON.stringify([link.from, link.to])} className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                {link.to}{link.label ? ` [${link.label}]` : ''}
              </span>
              <button
                type="button"
                aria-label={`Remove link from ${link.from} to ${link.to}`}
                onClick={() => onRemoveLink(link.from, link.to)}
                className="rounded px-1.5 py-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 aria-hidden="true" size={13} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <select
              aria-label={`Next step target for ${step.id}`}
              value={nextTargetId}
              onChange={(event) => setNextTargetId(event.target.value)}
              className={`${inputClass} min-w-0 flex-1 text-xs`}
            >
              <option value="">Choose target</option>
              {stepIds
                .filter((stepId) => stepId !== step.id)
                .map((stepId) => (
                  <option key={stepId} value={stepId}>
                    {`${stepId} · ${stepLabels.get(stepId) ?? ''}`}
                  </option>
                ))}
            </select>
            {isDecision && (
              <select
                aria-label={`Next step label for ${step.id}`}
                value={nextLabel}
                onChange={(event) => setNextLabel(event.target.value)}
                className={`${inputClass} w-20 text-xs`}
              >
                <option value="">Yes/No</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            )}
            <button
              type="button"
              aria-label={`Add next step for ${step.id}`}
              disabled={!nextTargetId || (isDecision && !nextLabel)}
              onClick={() => {
                onAddLink(step.id, nextTargetId, isDecision ? nextLabel : undefined)
                setNextTargetId('')
                setNextLabel('')
              }}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-center">
        <div className="flex items-center justify-center">
          <button
            type="button"
            aria-label={`Move ${step.id} up`}
            disabled={isFirst}
            onClick={() => onMove(step.id, -1)}
            className="inline-flex size-8 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            aria-label={`Move ${step.id} down`}
            disabled={isLast}
            onClick={() => onMove(step.id, 1)}
            className="inline-flex size-8 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowDown aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            aria-label={`Insert row below ${step.id}`}
            title="Insert row below"
            onClick={() => onInsertBelow(step.id)}
            className="inline-flex size-8 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Plus aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${step.id}`}
            title="Delete row"
            onClick={() => onDelete(step.id)}
            className="inline-flex size-9 items-center justify-center rounded text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
        </div>
      </td>
    </tr>
  )
})

function StepMatrix({ steps, links, onStepsChange, onLinksChange, onGenerate }: StepMatrixProps) {
  const [generated, setGenerated] = useState(false)
  const [importPreview, setImportPreview] = useState<{
    steps: Step[]
    errors: string[]
    fileName: string
  } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const stepIdsKey = JSON.stringify(steps.map((step) => step.id))
  const stepIds = useMemo((): string[] => JSON.parse(stepIdsKey), [stepIdsKey])
  const stepLabels = useMemo(
    () => new Map(steps.map((s) => [s.id, s.stepName?.trim() || 'Untitled step'])),
    [steps],
  )
  const warnings = useMemo(() => computeWarnings(steps, links), [steps, links])
  const departmentOptions = useMemo(
    () =>
      [...new Set(steps.map((step) => step.department.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [steps],
  )

  const updateStep = useCallback(
    (stepId: string, field: StepField, value: string) => {
      setGenerated(false)
      const nextId = value.trim()
      if (
        field === 'id' &&
        (!nextId || (nextId !== stepId && stepIds.includes(nextId)))
      ) return

      onStepsChange((currentSteps) => {
        if (field === 'id') {
          const nextId = value.trim()
          if (!nextId || currentSteps.some((step) => step.id === nextId && step.id !== stepId)) {
            return currentSteps
          }
          return currentSteps.map((step) => {
            if (step.id === stepId) return { ...step, id: nextId }
            const next = { ...step }
            if (step.predecessorId === stepId) next.predecessorId = nextId
            if (step.sequenceFlows?.some((flow) => flow.targetId === stepId)) {
              next.sequenceFlows = step.sequenceFlows.map((flow) =>
                flow.targetId === stepId ? { ...flow, targetId: nextId } : flow,
              )
            }
            return next
          })
        }

        if (field === 'stepType') {
          if (!stepTypes.includes(value as StepType)) return currentSteps
          return currentSteps.map((step) =>
            step.id === stepId ? { ...step, stepType: value as StepType } : step,
          )
        }

        return currentSteps.map((step) => (step.id === stepId ? { ...step, [field]: value } : step))
      })

      if (field === 'id' && nextId !== stepId) {
        onLinksChange((currentLinks) =>
          currentLinks.map((link) => {
            const from = link.from === stepId ? nextId : link.from
            const to = link.to === stepId ? nextId : link.to
            return from === link.from && to === link.to
              ? link
              : { ...link, id: `${from}>${to}`, from, to }
          }),
        )
      }
    },
    [onLinksChange, onStepsChange, stepIds],
  )

  const addLink = useCallback(
    (from: string, to: string, label?: string) => {
      setGenerated(false)
      onLinksChange((currentLinks) =>
        currentLinks.some((link) => link.from === from && link.to === to)
          ? currentLinks
          : [...currentLinks, {
              id: `${from}>${to}`,
              from,
              to,
              ...(label ? { label } : {}),
            }],
      )
    },
    [onLinksChange],
  )

  const removeLink = useCallback(
    (from: string, to: string) => {
      setGenerated(false)
      onLinksChange((currentLinks) =>
        currentLinks.filter((link) => link.from !== from || link.to !== to),
      )
    },
    [onLinksChange],
  )

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

  const insertStepBelow = useCallback(
    (stepId: string) => {
      setGenerated(false)
      onStepsChange((currentSteps) => {
        const index = currentSteps.findIndex((step) => step.id === stepId)
        if (index === -1) return currentSteps
        const current = currentSteps[index]
        const newStep: Step = {
          id: getNextStepId(currentSteps),
          stepName: '',
          department: current.department,
          stepType: 'Task',
          predecessorId: '',
          condition: '',
        }
        const result = [...currentSteps]
        result.splice(index + 1, 0, newStep)
        return result
      })
    },
    [onStepsChange],
  )

  const moveStep = useCallback(
    (stepId: string, direction: -1 | 1) => {
      setGenerated(false)
      onStepsChange((currentSteps) => {
        const index = currentSteps.findIndex((step) => step.id === stepId)
        const target = index + direction
        if (index === -1 || target < 0 || target >= currentSteps.length) return currentSteps
        const result = [...currentSteps]
        ;[result[index], result[target]] = [result[target], result[index]]
        return result
      })
    },
    [onStepsChange],
  )

  const exportCsv = useCallback(() => {
    const header = [
      'Step ID',
      'Step name',
      'Department',
      'Step type',
      'Predecessor',
      'Branch label',
      'Lane ID',
    ]
    const rows = steps.map((step) =>
      [
        step.id,
        step.stepName,
        step.department,
        step.stepType,
        step.predecessorId,
        step.condition,
        step.laneId ?? '',
      ]
        .map(toCsvCell)
        .join(','),
    )
    const csv = [header.join(','), ...rows].join('\r\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'process-steps.csv'
    link.click()
    URL.revokeObjectURL(url)
  }, [steps])

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    try {
      const result = parseStepsCsv(await file.text())
      setImportPreview({ ...result, fileName: file.name })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setImportPreview({
        steps: [],
        errors: [`Could not read "${file.name}": ${message}`],
        fileName: file.name,
      })
    } finally {
      input.value = ''
    }
  }

  function applyImport() {
    if (!importPreview?.steps.length) return
    if (!window.confirm('This will replace the current table. Continue?')) return
    onStepsChange(importPreview.steps)
    onLinksChange(toFlowModel({ steps: importPreview.steps }).model.links)
    setGenerated(false)
    setImportPreview(null)
  }

  const deleteStep = useCallback(
    (stepId: string) => {
      setGenerated(false)
      onStepsChange((currentSteps) => currentSteps.filter((step) => step.id !== stepId))
      onLinksChange((currentLinks) =>
        currentLinks.filter((link) => link.from !== stepId && link.to !== stepId),
      )
    },
    [onLinksChange, onStepsChange],
  )

  function generateFlowchart() {
    onGenerate?.(fromFlowModel({ schemaVersion: 2, steps, links }).steps)
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

      <datalist id="department-options" hidden>
        {departmentOptions.map((department) => (
          <option key={department} value={department} />
        ))}
      </datalist>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <h3 className="font-semibold">{warnings.length} items to check</h3>
          <ul className="mt-1 list-inside list-disc">
            {warnings.map((warning, index) => (
              <li key={`${warning.stepId}-${index}`}>
                {warning.stepId}: {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <colgroup>
            {columnWidths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="border-b border-slate-200 px-2 py-3">Step ID</th>
              <th scope="col" className="border-b border-slate-200 px-2 py-3">Step name</th>
              <th scope="col" className="border-b border-slate-200 px-2 py-3">Department</th>
              <th scope="col" className="border-b border-slate-200 px-2 py-3">Step type</th>
              <th scope="col" className="border-b border-slate-200 px-2 py-3">Incoming</th>
              <th scope="col" className="border-b border-slate-200 px-2 py-3">Next steps</th>
              <th scope="col" className="border-b border-slate-200 px-3 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {steps.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
                stepIds={stepIds}
                stepLabels={stepLabels}
                incomingLinks={links.filter((link) => link.to === step.id)}
                outgoingLinks={links.filter((link) => link.from === step.id)}
                isDecision={step.stepType === 'Decision Point' || step.stepType === 'Exclusive Gateway'}
                hasWarning={warnings.some((warning) => warning.stepId === step.id)}
                onUpdate={updateStep}
                onAddLink={addLink}
                onRemoveLink={removeLink}
                onDelete={deleteStep}
                onInsertBelow={insertStepBelow}
                onMove={moveStep}
                isFirst={index === 0}
                isLast={index === steps.length - 1}
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
        <button
          type="button"
          onClick={exportCsv}
          disabled={steps.length === 0}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download aria-hidden="true" size={16} />
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
        >
          <Upload aria-hidden="true" size={16} />
          Import CSV
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleImportFile}
        />
        {generated && (
          <span role="status" className="text-sm text-emerald-700">
            Flowchart data generated from {steps.length} {steps.length === 1 ? 'step' : 'steps'}.
          </span>
        )}
      </div>
      {importPreview && (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
          <div>
            <h3 className="font-semibold text-slate-900">
              Import preview: {importPreview.fileName}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {importPreview.steps.length} valid rows · {importPreview.errors.length} issues
            </p>
          </div>
          {importPreview.errors.length > 0 && (
            <ul className="max-h-60 list-inside list-disc space-y-1 overflow-auto bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-3 text-sm">
              {importPreview.errors.slice(0, 20).map((error, index) => (
                <li key={`${index}-${error}`}>{error}</li>
              ))}
              {importPreview.errors.length > 20 && (
                <li>and {importPreview.errors.length - 20} more</li>
              )}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={applyImport}
              disabled={importPreview.steps.length === 0}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Replace table with these rows
            </button>
            <button
              type="button"
              onClick={() => setImportPreview(null)}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default StepMatrix