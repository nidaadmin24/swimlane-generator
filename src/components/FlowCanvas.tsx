import { memo, useMemo, useRef, useState } from 'react'
import dagre from 'dagre'
import { toPng } from 'html-to-image'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Download, Printer, X } from 'lucide-react'
import type { SequenceFlow, Step } from '../types'
import '@xyflow/react/dist/style.css'

const NODE_WIDTH = 184
const NODE_HEIGHT = 76
const LANE_HEIGHT = 144
const LANE_GAP = 16
const LABEL_WIDTH = 176
const LANE_RIGHT_PADDING = 48
type LaneNode = Node<{ label: string; poolName: string }, 'lane'>
type ProcessStepFlowNode = Node<{ step: Step }, 'processStep'>
type FlowNode = LaneNode | ProcessStepFlowNode

interface LaneGroup {
  key: string
  label: string
  poolName: string
  steps: Step[]
}

interface RenderedFlow extends SequenceFlow {
  sourceId: string
}

interface FlowCanvasProps {
  steps: Step[]
  processTitle: string
}

function getPngFilename(processTitle: string): string {
  const filename = processTitle
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/, '')

  return `${filename || 'swimlane-flowchart'}.png`
}

function getLaneLabel(step: Step): string {
  return step.laneName?.trim() || step.department?.trim() || 'Unassigned'
}

function getBranchConditions(condition: string): string[] {
  return condition
    .split(/\s*(?:\/|\||,|\band\b)\s*/i)
    .map((label) => label.trim())
    .filter(Boolean)
}

function getStepSequenceNumber(stepId: string): number | undefined {
  const match = /^STEP-(\d+)$/i.exec(stepId)
  return match ? Number(match[1]) : undefined
}

function layoutSteps(
  steps: Step[],
): { nodes: FlowNode[]; edges: Edge[]; width: number; height: number; laneCount: number } {
  const stepsById = new Map<string, Step>()
  const lanesByKey = new Map<string, LaneGroup>()

  steps.forEach((step) => {
    stepsById.set(step.id, step)
    const label = getLaneLabel(step)
    const poolName = step.poolName?.trim() || ''
    const laneIdentity = step.laneId?.trim() || label
    const poolIdentity = step.poolId?.trim() || poolName || 'default-pool'
    const key = `${poolIdentity}\u0000${laneIdentity}`
    let lane = lanesByKey.get(key)
    if (!lane) {
      lane = { key, label, poolName, steps: [] }
      lanesByKey.set(key, lane)
    }
    lane.steps.push(step)
  })
  const lanes = [...lanesByKey.values()]

  const laneLayouts = lanes.map((lane) => {
    const departmentSteps = lane.steps
    const stepIds = new Set(departmentSteps.map((step) => step.id))
    const graph = new dagre.graphlib.Graph()

    graph.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 120, marginx: 24, marginy: 20 })
    graph.setDefaultEdgeLabel(() => ({}))

    departmentSteps.forEach((step) => {
      graph.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
    })

    departmentSteps.forEach((step) => {
      for (const flow of step.sequenceFlows ?? []) {
        if (stepIds.has(flow.targetId)) graph.setEdge(step.id, flow.targetId)
      }
      if (step.predecessorId && stepIds.has(step.predecessorId)) {
        graph.setEdge(step.predecessorId, step.id)
      }
    })

    dagre.layout(graph)
    const graphWidth = Math.max(
      graph.graph().width ?? 0,
      departmentSteps.length * (NODE_WIDTH + 64),
    )
    return {
      key: lane.key,
      department: lane.label,
      poolName: lane.poolName,
      steps: departmentSteps,
      graph,
      width: graphWidth + LABEL_WIDTH + LANE_RIGHT_PADDING,
    }
  })

  const canvasWidth = Math.max(760, ...laneLayouts.map((lane) => lane.width))
  const nodes: FlowNode[] = []
  const stepPositions = new Map<string, { x: number; y: number }>()

  laneLayouts.forEach((lane, laneIndex) => {
    const laneY = laneIndex * (LANE_HEIGHT + LANE_GAP)
    const laneId = `lane-${laneIndex}`

    nodes.push({
      id: laneId,
      type: 'lane',
      position: { x: 0, y: laneY },
      data: { label: lane.department, poolName: lane.poolName },
      style: { width: canvasWidth, height: LANE_HEIGHT },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: -1,
    })

    const orderedSteps = lane.steps
      .map((step, index) => ({ step, index, sequence: getStepSequenceNumber(step.id) }))
      .sort((left, right) => {
        if (left.sequence !== undefined && right.sequence !== undefined) {
          return left.sequence - right.sequence || left.index - right.index
        }
        if (left.sequence !== undefined) return -1
        if (right.sequence !== undefined) return 1
        return left.index - right.index
      })

    orderedSteps.forEach(({ step }, stepIndex) => {
      const nodePosition = {
        x: LABEL_WIDTH + 24 + stepIndex * (NODE_WIDTH + 64),
        y: laneY + (LANE_HEIGHT - NODE_HEIGHT) / 2,
      }
      stepPositions.set(step.id, nodePosition)
      nodes.push({
        id: step.id,
        type: 'processStep',
        position: nodePosition,
        data: { step },
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      })
    })
  })

  const flows: RenderedFlow[] = []
  const explicitConnections = new Set<string>()
  steps.forEach((source) => {
    for (const flow of source.sequenceFlows ?? []) {
      if (!stepsById.has(flow.targetId)) continue
      flows.push({ ...flow, sourceId: source.id })
      explicitConnections.add(`${source.id}\u0000${flow.targetId}`)
    }
  })
  steps.forEach((target) => {
    const source = stepsById.get(target.predecessorId)
    if (!source) return
    const connection = `${source.id}\u0000${target.id}`
    if (explicitConnections.has(connection)) return
    flows.push({
      id: `edge-${source.id}-${target.id}`,
      sourceId: source.id,
      targetId: target.id,
      label: target.condition,
    })
  })

  const branchIndexes = new Map<string, number>()
  const branchConditionsByStep = new Map<string, string[]>()
  const edges: Edge[] = []
  flows.forEach((flow) => {
    const source = stepsById.get(flow.sourceId)
    const target = stepsById.get(flow.targetId)
    if (
      !source ||
      !target ||
      !stepPositions.has(source.id) ||
      !stepPositions.has(target.id)
    ) return

    let label = flow.label?.trim() || flow.conditionExpression?.trim() || ''
    if (
      !label &&
      !flow.isDefault &&
      (source.stepType === 'Decision Point' || source.stepType === 'Exclusive Gateway') &&
      source.condition?.trim()
    ) {
      if (!branchConditionsByStep.has(source.id)) {
        branchConditionsByStep.set(source.id, getBranchConditions(source.condition))
      }
      const branchConditions = branchConditionsByStep.get(source.id) ?? []
      const branchIndex = branchIndexes.get(source.id) ?? 0
      label = branchConditions[branchIndex] ?? ''
      branchIndexes.set(source.id, branchIndex + 1)
    }

    const predecessorCondition = target.condition.trim().toLowerCase()
    const isDecisionPredecessor =
      source.stepType === 'Decision Point' && target.predecessorId === source.id
    const sourceHandle = isDecisionPredecessor && predecessorCondition === 'yes'
      ? 'bottom'
      : isDecisionPredecessor && predecessorCondition === 'no'
        ? 'right'
        : (source.stepType === 'Decision Point' || source.stepType === 'Exclusive Gateway') &&
            label.toLowerCase() === 'yes'
          ? 'bottom'
          : 'right'

    edges.push({
      id: flow.id,
      source: source.id,
      target: target.id,
      sourceHandle,
      type: 'smoothstep',
      label,
      labelStyle: { fill: '#475569', fontSize: 12, fontWeight: 600 },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.96 },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
      style: { stroke: '#64748b', strokeWidth: 1.8 },
    })
  })

  return {
    nodes,
    edges,
    width: canvasWidth,
    laneCount: laneLayouts.length,
    height: laneLayouts.length
      ? laneLayouts.length * LANE_HEIGHT + (laneLayouts.length - 1) * LANE_GAP
      : 320,
  }
}

function SwimlaneNode({ data }: NodeProps<LaneNode>) {
  return (
    <div className="h-full w-full overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex h-full">
        <div className="flex w-40 shrink-0 items-center border-r border-slate-200 bg-slate-50 px-4">
          <div className="min-w-0">
            {data.poolName && (
              <span className="block truncate text-[9px] font-semibold uppercase tracking-wider text-sky-700">
                {data.poolName}
              </span>
            )}
            <span className="block break-words text-sm font-bold uppercase tracking-wide text-slate-600">
              {data.label}
            </span>
          </div>
        </div>
        <div className="flex-1 bg-[linear-gradient(to_right,#f8fafc_1px,transparent_1px)] bg-[size:28px_28px]" />
      </div>
    </div>
  )
}

function ProcessStepNode({ data }: NodeProps<ProcessStepFlowNode>) {
  const { step } = data
  const isStart = step.stepType === 'Start Event'
  const isEnd = step.stepType === 'End Event'
  const isExclusiveGateway =
    step.stepType === 'Decision Point' || step.stepType === 'Exclusive Gateway'
  const isParallelGateway = step.stepType === 'Parallel Gateway'
  const isGateway = isExclusiveGateway || isParallelGateway
  const isArtifact = step.stepType === 'Data/Artifact'
  const isEvent = isStart || isEnd
  const taskLabel = step.stepType.endsWith('Task')
    ? step.stepType.replace(' Task', '')
    : step.stepType === 'Task'
      ? 'Task'
      : ''

  let shapeClass = 'rounded-md border border-sky-300 bg-white shadow-sm'
  if (isEvent) shapeClass = `flex size-[68px] flex-col items-center justify-center rounded-full text-center ${isStart ? 'border-2 border-emerald-500 bg-emerald-50' : 'border-[3px] border-rose-600 bg-rose-50'}`
  if (isArtifact) shapeClass = 'rounded-md border border-amber-400 bg-amber-50 shadow-sm'

  return (
    <>
      <Handle type="target" position={Position.Left} className="!size-2 !border-2 !border-white !bg-slate-500" />
      <div className="relative flex h-full w-full items-center justify-center">
        {isGateway ? (
          <div className="flex size-[68px] rotate-45 items-center justify-center border-2 border-amber-500 bg-amber-50 shadow-sm">
            <div className="flex w-[56px] max-w-full -rotate-45 flex-col items-center justify-center text-center">
              {isParallelGateway ? (
                <span className="text-base font-bold leading-none text-amber-700">+</span>
              ) : (
                <X aria-hidden="true" size={13} className="text-amber-700" />
              )}
              <span className="max-w-full break-words text-xs font-semibold text-slate-800">
                {step.stepName || 'Gateway'}
              </span>
              <span className="mt-0.5 font-mono text-[9px] font-bold text-slate-500">{step.id}</span>
            </div>
          </div>
        ) : isEvent ? (
          <div className={shapeClass} aria-label={`${step.stepType}: ${step.stepName || step.id}`}>
            <span className="max-w-[52px] break-words text-[9px] font-semibold leading-tight text-slate-800">
              {step.stepName || (isStart ? 'Start' : 'End')}
            </span>
            <span className="mt-1 font-mono text-[8px] font-bold text-slate-500">{step.id}</span>
          </div>
        ) : (
          <div className={`flex h-[60px] w-[164px] flex-col items-center justify-center px-3 text-center ${shapeClass}`}>
            <span className="max-w-full truncate text-sm font-medium text-slate-800">
              {step.stepName || 'Untitled step'}
            </span>
            <span className="mt-1 max-w-full truncate font-mono text-[9px] font-bold text-slate-500">
              {taskLabel ? `${taskLabel} · ` : ''}{step.id}
            </span>
          </div>
        )}
      </div>
      {isGateway && (
        <Handle
          id="bottom"
          type="source"
          position={Position.Bottom}
          className="!size-2 !border-2 !border-white !bg-slate-500"
        />
      )}
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className="!size-2 !border-2 !border-white !bg-slate-500"
      />
    </>
  )
}

function FlowCanvas({ steps, processTitle }: FlowCanvasProps) {
  const layout = useMemo(
    () => layoutSteps(steps),
    [steps],
  )
  const canvasRef = useRef<HTMLDivElement>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const nodeTypes = useMemo(
    () => ({ lane: SwimlaneNode, processStep: ProcessStepNode }),
    [],
  )

  async function handleExportPNG() {
    const viewport = canvasRef.current?.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewport) {
      setExportMessage('PNG export failed: flowchart canvas is not available.')
      return
    }

    setIsExporting(true)
    setExportMessage('Exporting PNG...')

    try {
      const dataUrl = await toPng(viewport, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#ffffff',
      })
      const downloadLink = document.createElement('a')
      downloadLink.download = getPngFilename(processTitle)
      downloadLink.href = dataUrl
      downloadLink.click()
      setExportMessage('PNG exported successfully.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportMessage(`PNG export failed: ${message}`)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Process flow</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {steps.length} {steps.length === 1 ? 'step' : 'steps'} across{' '}
            {layout.laneCount}{' '}
            {layout.laneCount === 1 ? 'lane' : 'lanes'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
            >
              <Printer aria-hidden="true" size={15} />
              Print / Export PDF
            </button>
            <button
              type="button"
              onClick={handleExportPNG}
              disabled={!steps.length || isExporting}
              aria-busy={isExporting}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download aria-hidden="true" size={15} />
              {isExporting ? 'Exporting PNG...' : 'Export PNG'}
            </button>
          </div>
          {exportMessage && (
            <p
              className={`text-xs ${exportMessage.startsWith('PNG export failed') ? 'text-rose-700' : 'text-slate-500'}`}
              role={exportMessage.startsWith('PNG export failed') ? 'alert' : 'status'}
              aria-live="polite"
            >
              {exportMessage}
            </p>
          )}
        </div>
      </header>

      <div className="bg-slate-50 p-3 sm:p-5">
        {steps.length ? (
          <div className="overflow-auto rounded border border-slate-200 bg-white">
            <div ref={canvasRef} style={{ height: layout.height, minWidth: layout.width }}>
              <ReactFlow
                nodes={layout.nodes}
                edges={layout.edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.16, minZoom: 0.35, maxZoom: 1 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
              >
                <Background color="#dbe3ec" gap={18} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(node) => node.type === 'lane' ? '#e2e8f0' : '#38bdf8'}
                  maskColor="rgba(248, 250, 252, 0.72)"
                />
              </ReactFlow>
            </div>
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center rounded border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-slate-500">
            Add process steps to display the flowchart.
          </div>
        )}
      </div>
    </section>
  )
}

export default memo(FlowCanvas)
