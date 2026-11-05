import { memo, useMemo, useRef, useState, type CSSProperties } from 'react'
import { toPng } from 'html-to-image'
import { Download, Maximize2, Minus, Plus, Printer, X } from 'lucide-react'
import type { Step } from '../types'

const TASK_W = 176
const TASK_MIN_H = 64
const TASK_LINE_H = 17
const TASK_TEXT_MAX_CHARS = 22
const EVENT_D = 56
const GATEWAY_D = 64
const LABEL_BLOCK_H = 50
const LABEL_W = 160
const LEFT_PAD = 24
const COL_GAP = 88
const COL_W = TASK_W + COL_GAP
const FIRST_COL_CX = LABEL_W + LEFT_PAD + TASK_W / 2
const MIN_NODE_GAP = 32
const LANE_PAD = 36
const MIN_LANE_H = 120
const EXIT_GAP = 12
const CHANNEL_OFFSET = 14
const CHANNEL_SPACING = 9
const PORT_SPACING = 10
const PORT_MARGIN = 8
const CORNER_RADIUS = 10
const MERGE_JITTER = 6
const MIN_CANVAS_W = 820
const CANVAS_RIGHT_PAD = 60
const MIN_ZOOM = 0.4
const MAX_ZOOM = 1.5
const LANE_TINTS = [
  { body: '#f8fafc', header: '#e2e8f0' },
  { body: '#f0f9ff', header: '#e0f2fe' },
  { body: '#f0fdf4', header: '#dcfce7' },
  { body: '#fefce8', header: '#fef9c3' },
  { body: '#faf5ff', header: '#f3e8ff' },
]

type NodeKind = 'start' | 'end' | 'task' | 'artifact' | 'gateway' | 'parallel'

interface Point { x: number; y: number }
interface Box { x: number; y: number; w: number; h: number }
interface PositionedNode { step: Step; kind: NodeKind; box: Box }
interface PositionedEdge {
  id: string
  label: string
  points: Point[]
  labelAt: Point
  labelAnchor: 'start' | 'middle'
}
interface PositionedLane { key: string; label: string; poolName: string; top: number; height: number }
interface FlowLayout {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  lanes: PositionedLane[]
  width: number
  height: number
}
interface RawEdge { id: string; sourceId: string; targetId: string; label: string }
interface FlowCanvasProps {
  steps: Step[]
  processTitle: string
  folder?: string
  owner?: string
}

function getLaneLabel(step: Step): string {
  return step.laneName?.trim() || step.department?.trim() || 'Unassigned'
}

function getKind(step: Step): NodeKind {
  switch (step.stepType) {
    case 'Start Event': return 'start'
    case 'End Event': return 'end'
    case 'Decision Point':
    case 'Exclusive Gateway': return 'gateway'
    case 'Parallel Gateway': return 'parallel'
    case 'Data/Artifact': return 'artifact'
    default: return 'task'
  }
}

function hasLabelAbove(kind: NodeKind): boolean {
  return kind !== 'task' && kind !== 'artifact'
}

function countWrappedLines(text: string, maxChars: number): number {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1
  let lines = 1
  let current = 0
  for (const word of words) {
    if (current === 0) {
      current = word.length
    } else if (current + 1 + word.length <= maxChars) {
      current += 1 + word.length
    } else {
      lines += 1
      current = word.length
    }
  }
  return lines
}

function getShapeSize(step: Step, kind: NodeKind): { w: number; h: number } {
  if (kind === 'start' || kind === 'end') return { w: EVENT_D, h: EVENT_D }
  if (kind === 'gateway' || kind === 'parallel') return { w: GATEWAY_D, h: GATEWAY_D }
  const title = step.stepName?.trim() || 'Untitled step'
  const lines = countWrappedLines(title, TASK_TEXT_MAX_CHARS)
  return {
    w: TASK_W,
    h: Math.max(TASK_MIN_H, lines * TASK_LINE_H + 22 + 20),
  }
}

function getNodeTitle(step: Step, kind: NodeKind): string {
  const fallback =
    kind === 'start' ? 'Start'
    : kind === 'end' ? 'End'
    : kind === 'gateway' || kind === 'parallel' ? 'Gateway'
    : 'Untitled step'
  return step.stepName?.trim() || fallback
}

function normalizeBranchLabel(label: string): string {
  if (/^yes$/i.test(label)) return 'Yes'
  if (/^no$/i.test(label)) return 'No'
  return label
}

function getBranchLabelColor(label: string): string {
  if (label === 'Yes') return '#047857'
  if (label === 'No') return '#be123c'
  return '#334155'
}

function collectEdges(steps: Step[], stepsById: Map<string, Step>): RawEdge[] {
  const edges = new Map<string, RawEdge>()
  const keyOf = (source: string, target: string) => `${source}\u0000${target}`

  steps.forEach((step) => {
    for (const flow of step.sequenceFlows ?? []) {
      if (flow.targetId === step.id || !stepsById.has(flow.targetId)) continue
      const label = flow.label?.trim() || flow.conditionExpression?.trim() || ''
      edges.set(keyOf(step.id, flow.targetId), {
        id: flow.id || `edge-${step.id}-${flow.targetId}`,
        sourceId: step.id,
        targetId: flow.targetId,
        label: normalizeBranchLabel(label),
      })
    }
  })

  steps.forEach((step) => {
    const predecessor = stepsById.get(step.predecessorId)
    if (!predecessor || predecessor.id === step.id) return
    const key = keyOf(predecessor.id, step.id)
    if (edges.has(key)) return
    edges.set(key, {
      id: `edge-${predecessor.id}-${step.id}`,
      sourceId: predecessor.id,
      targetId: step.id,
      label: normalizeBranchLabel(step.condition?.trim() ?? ''),
    })
  })

  return [...edges.values()]
}

function computeRanks(ids: string[], edges: RawEdge[]): Map<string, number> {
  const outgoing = new Map<string, string[]>()
  const hasIncoming = new Set<string>()
  edges.forEach((edge) => {
    outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) ?? []), edge.targetId])
    hasIncoming.add(edge.targetId)
  })

  const state = new Map<string, 'visiting' | 'done'>()
  const backEdges = new Set<string>()
  const postOrder: string[] = []

  const visit = (id: string) => {
    state.set(id, 'visiting')
    for (const next of outgoing.get(id) ?? []) {
      const nextState = state.get(next)
      if (nextState === 'visiting') backEdges.add(`${id}\u0000${next}`)
      else if (!nextState) visit(next)
    }
    state.set(id, 'done')
    postOrder.push(id)
  }

  const roots = ids.filter((id) => !hasIncoming.has(id))
  ;[...roots, ...ids].forEach((id) => {
    if (!state.has(id)) visit(id)
  })

  const rank = new Map<string, number>(ids.map((id) => [id, 0]))
  postOrder.reverse().forEach((source) => {
    for (const target of outgoing.get(source) ?? []) {
      if (backEdges.has(`${source}\u0000${target}`)) continue
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(source) ?? 0) + 1))
    }
  })
  return rank
}

function isForwardRoute(source: Box, target: Box): boolean {
  return target.x >= source.x + source.w + EXIT_GAP
}

function routeEdge(
  source: Box,
  target: Box,
  options: {
    exitsFromBottom: boolean
    index: number
    backSlot: number
    sourceShift: number
    targetShift: number
  },
): Point[] {
  const sCx = source.x + source.w / 2 + options.sourceShift
  const sCy = source.y + source.h / 2
  const sRight = source.x + source.w
  const sTop = source.y
  const sBottom = source.y + source.h
  const tCx = target.x + target.w / 2 + options.targetShift
  const tCy = target.y + target.h / 2
  const tTop = target.y
  const tBottom = target.y + target.h

  if (isForwardRoute(source, target)) {
    if (options.exitsFromBottom && tCy > sBottom) {
      return [
        { x: sCx, y: sBottom },
        { x: sCx, y: tCy },
        { x: target.x, y: tCy },
      ]
    }
    if (options.exitsFromBottom) {
      const channelY =
        Math.max(sBottom, tBottom) + CHANNEL_OFFSET + (options.index % 3) * CHANNEL_SPACING
      return [
        { x: sCx, y: sBottom },
        { x: sCx, y: channelY },
        { x: tCx, y: channelY },
        { x: tCx, y: tBottom },
      ]
    }
    if (Math.abs(sCy - tCy) < 1) {
      return [{ x: sRight, y: sCy }, { x: target.x, y: tCy }]
    }
    const midX = sRight + COL_GAP / 2 + ((options.index % 3) - 1) * MERGE_JITTER
    return [
      { x: sRight, y: sCy },
      { x: midX, y: sCy },
      { x: midX, y: tCy },
      { x: target.x, y: tCy },
    ]
  }

  const offset = (options.backSlot % 3) * CHANNEL_SPACING
  const below = tCy >= sCy

  if (Math.abs(sCx - tCx) < 1) {
    return below
      ? [{ x: sCx, y: sBottom }, { x: tCx, y: tTop }]
      : [{ x: sCx, y: sTop }, { x: tCx, y: tBottom }]
  }

  if (below) {
    const channelY = Math.max(sBottom, tBottom) + CHANNEL_OFFSET + offset
    return [
      { x: sCx, y: sBottom },
      { x: sCx, y: channelY },
      { x: tCx, y: channelY },
      { x: tCx, y: tBottom },
    ]
  }

  const channelY = Math.min(sTop, tTop) - CHANNEL_OFFSET - offset
  return [
    { x: sCx, y: sTop },
    { x: sCx, y: channelY },
    { x: tCx, y: channelY },
    { x: tCx, y: tTop },
  ]
}

function getLabelAnchor(points: Point[]): { at: Point; anchor: 'start' | 'middle' } {
  const [a, b] = points
  if (Math.abs(a.y - b.y) < 1) {
    return { at: { x: (a.x + b.x) / 2, y: a.y - 8 }, anchor: 'middle' }
  }
  return { at: { x: a.x + 8, y: (a.y + b.y) / 2 }, anchor: 'start' }
}

function getRoundedOrthogonalPath(points: Point[], radius: number): string {
  const compact = points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y,
  )
  if (compact.length < 2) return ''

  let path = `M ${compact[0].x},${compact[0].y}`
  for (let i = 1; i < compact.length - 1; i += 1) {
    const prev = compact[i - 1]
    const cur = compact[i]
    const next = compact[i + 1]
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (!r) continue
    const before = {
      x: cur.x - ((cur.x - prev.x) / inLen) * r,
      y: cur.y - ((cur.y - prev.y) / inLen) * r,
    }
    const after = {
      x: cur.x + ((next.x - cur.x) / outLen) * r,
      y: cur.y + ((next.y - cur.y) / outLen) * r,
    }
    path += ` L ${before.x},${before.y} Q ${cur.x},${cur.y} ${after.x},${after.y}`
  }
  const last = compact[compact.length - 1]
  return `${path} L ${last.x},${last.y}`
}
function layoutFlow(steps: Step[]): FlowLayout {
  const stepsById = new Map<string, Step>(steps.map((step) => [step.id, step]))
  const kinds = new Map<string, NodeKind>(steps.map((step) => [step.id, getKind(step)]))
  const sizes = new Map<string, { w: number; h: number }>(
    steps.map((step) => [step.id, getShapeSize(step, kinds.get(step.id)!)]),
  )

  const laneMap = new Map<string, { key: string; label: string; poolName: string; stepIds: string[] }>()
  const laneKeyOf = new Map<string, string>()
  steps.forEach((step) => {
    const label = getLaneLabel(step)
    const poolName = step.poolName?.trim() || ''
    const laneIdentity = step.laneId?.trim() || label
    const poolIdentity = step.poolId?.trim() || poolName || 'default-pool'
    const key = `${poolIdentity}\u0000${laneIdentity}`
    const lane = laneMap.get(key) ?? { key, label, poolName, stepIds: [] }
    lane.stepIds.push(step.id)
    laneMap.set(key, lane)
    laneKeyOf.set(step.id, key)
  })
  const lanes = [...laneMap.values()]

  const edges = collectEdges(steps, stepsById)
  const rank = computeRanks(steps.map((step) => step.id), edges)

  const centerX = new Map<string, number>(
    steps.map((step) => [step.id, FIRST_COL_CX + (rank.get(step.id) ?? 0) * COL_W]),
  )

  lanes.forEach((lane) => {
    let previousRight = Number.NEGATIVE_INFINITY
    ;[...lane.stepIds]
      .sort((a, b) => centerX.get(a)! - centerX.get(b)!)
      .forEach((id) => {
        const { w } = sizes.get(id)!
        const cx = Math.max(centerX.get(id)!, previousRight + MIN_NODE_GAP + w / 2)
        centerX.set(id, cx)
        previousRight = cx + w / 2
      })
  })

  let top = 0
  const laneLayouts: PositionedLane[] = []
  const laneCenterY = new Map<string, number>()
  lanes.forEach((lane) => {
    const shapeMax = Math.max(...lane.stepIds.map((id) => sizes.get(id)!.h))
    const labelMax = lane.stepIds.some((id) => hasLabelAbove(kinds.get(id)!)) ? LABEL_BLOCK_H : 0
    const height = Math.max(MIN_LANE_H, LANE_PAD * 2 + labelMax + shapeMax)
    laneLayouts.push({ key: lane.key, label: lane.label, poolName: lane.poolName, top, height })
    laneCenterY.set(lane.key, top + height - LANE_PAD - shapeMax / 2)
    top += height
  })

  const nodes = new Map<string, PositionedNode>()
  steps.forEach((step) => {
    const kind = kinds.get(step.id)!
    const { w, h } = sizes.get(step.id)!
    const cx = centerX.get(step.id)!
    const cy = laneCenterY.get(laneKeyOf.get(step.id)!)!
    nodes.set(step.id, { step, kind, box: { x: cx - w / 2, y: cy - h / 2, w, h } })
  })

  const MAX_SHIFT = (node: PositionedNode) =>
    Math.max(0, Math.min(node.box.w, node.box.h) / 2 - PORT_MARGIN)

  const centreOf = (node: PositionedNode) => ({
    x: node.box.x + node.box.w / 2,
    y: node.box.y + node.box.h / 2,
  })

  const portShifts = new Map<string, number>()
  const endsByNode = new Map<string, { key: string; otherId: string }[]>()

  edges.forEach((edge) => {
    if (!nodes.has(edge.sourceId) || !nodes.has(edge.targetId)) return
    const add = (nodeId: string, entry: { key: string; otherId: string }) =>
      endsByNode.set(nodeId, [...(endsByNode.get(nodeId) ?? []), entry])
    add(edge.sourceId, { key: `${edge.id}|s`, otherId: edge.targetId })
    add(edge.targetId, { key: `${edge.id}|t`, otherId: edge.sourceId })
  })

  endsByNode.forEach((ends, nodeId) => {
    const owner = nodes.get(nodeId)!
    if (owner.kind === 'gateway' || owner.kind === 'parallel') {
      ends.forEach((end) => portShifts.set(end.key, 0))
      return
    }
    const sorted = [...ends].sort((a, b) => {
      const pa = centreOf(nodes.get(a.otherId)!)
      const pb = centreOf(nodes.get(b.otherId)!)
      return pa.y - pb.y || pa.x - pb.x
    })
    const limit = MAX_SHIFT(owner)
    const n = sorted.length
    sorted.forEach((end, i) => {
      const raw = (i - (n - 1) / 2) * PORT_SPACING
      portShifts.set(end.key, Math.max(-limit, Math.min(limit, raw)))
    })
  })

  let backSlot = 0
  const positionedEdges: PositionedEdge[] = []
  edges.forEach((edge, index) => {
    const source = nodes.get(edge.sourceId)
    const target = nodes.get(edge.targetId)
    if (!source || !target) return

    const forward = isForwardRoute(source.box, target.box)
    const points = routeEdge(source.box, target.box, {
      exitsFromBottom: source.kind === 'gateway' && edge.label === 'Yes',
      index,
      backSlot,
      sourceShift: portShifts.get(`${edge.id}|s`) ?? 0,
      targetShift: portShifts.get(`${edge.id}|t`) ?? 0,
    })
    if (!forward) backSlot += 1

    const { at, anchor } = getLabelAnchor(points)
    positionedEdges.push({
      id: edge.id,
      label: edge.label,
      points,
      labelAt: at,
      labelAnchor: anchor,
    })
  })

  const nodeList = [...nodes.values()]
  const maxRight = Math.max(0, ...nodeList.map((node) => node.box.x + node.box.w))

  return {
    nodes: nodeList,
    edges: positionedEdges,
    lanes: laneLayouts,
    width: Math.max(MIN_CANVAS_W, maxRight + CANVAS_RIGHT_PAD),
    height: top,
  }
}

function NodeView({ node }: { node: PositionedNode }) {
  const { step, kind, box } = node
  const title = getNodeTitle(step, kind)

  if (kind === 'task' || kind === 'artifact') {
    const typeTag =
      kind === 'artifact'
        ? 'Artifact · '
        : step.stepType.endsWith(' Task')
          ? `${step.stepType.replace(' Task', '')} · `
          : ''
    return (
      <div
        className={`absolute flex flex-col items-center justify-center rounded-md border px-3 py-2 text-center ${
          kind === 'artifact' ? 'border-amber-400 bg-amber-50' : 'border-sky-400 bg-white'
        }`}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        title={`${step.stepType}: ${title}`}
      >
        <span className="block w-full whitespace-normal break-words text-center text-[13px] font-medium leading-[17px] text-slate-800">
          {title}
        </span>
        <span className="mt-1 font-mono text-[12px] font-semibold text-indigo-700">
          {typeTag}
          {step.id}
        </span>
      </div>
    )
  }

  const captionBox = (
    <div
      className="absolute flex flex-col items-center justify-end text-center"
      style={{
        left: box.x + box.w / 2 - 90,
        top: box.y - LABEL_BLOCK_H,
        width: 180,
        height: LABEL_BLOCK_H - 6,
      }}
    >
      <span className="max-w-full break-words text-[13px] font-medium leading-[17px] text-slate-800">
        {title}
      </span>
      <span className="font-mono text-[12px] font-semibold text-indigo-700">{step.id}</span>
    </div>
  )

  if (kind === 'start' || kind === 'end') {
    return (
      <>
        <div
          className={`absolute rounded-full ${
            kind === 'start'
              ? 'border-2 border-emerald-500 bg-emerald-50'
              : 'border-[3px] border-rose-600 bg-rose-50'
          }`}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          aria-label={`${kind === 'start' ? 'Start' : 'End'} event: ${title}`}
        />
        {captionBox}
      </>
    )
  }

  return (
    <>
      <div className="absolute" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
        <svg width={box.w} height={box.h} viewBox="0 0 64 64" aria-hidden="true">
          <polygon points="32,1 63,32 32,63 1,32" fill="#fffbeb" stroke="#d97706" strokeWidth={2} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {kind === 'parallel' ? (
            <span className="text-lg font-bold leading-none text-amber-700">+</span>
          ) : (
            <X aria-hidden="true" size={14} className="text-amber-700" />
          )}
        </div>
      </div>
      {captionBox}
    </>
  )
}

function getPngFilename(processTitle: string): string {
  const filename = processTitle
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/, '')
  return `${filename || 'swimlane-flowchart'}.png`
}

function FlowCanvas({ steps, processTitle, folder, owner }: FlowCanvasProps) {
  const layout = useMemo(() => layoutFlow(steps), [steps])
  // Scale for printing: fit the diagram on A3 landscape (about 1450 x 980 px printable area).
  const printScale = Math.min(1, 1450 / layout.width, 980 / layout.height)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [isExporting, setIsExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')

  const clampZoom = (value: number) =>
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 10) / 10))

  async function handleExportPNG() {
    const node = canvasRef.current
    if (!node) {
      setExportMessage('PNG export failed: flowchart canvas is not available.')
      return
    }

    setIsExporting(true)
    setExportMessage('Exporting PNG...')
    try {
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#ffffff',
        width: layout.width,
        height: layout.height,
        style: { transform: 'none' },
      })
      const link = document.createElement('a')
      link.download = getPngFilename(processTitle)
      link.href = dataUrl
      link.click()
      setExportMessage('PNG exported successfully.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportMessage(`PNG export failed: ${message}`)
    } finally {
      setIsExporting(false)
    }
  }

  const buttonClass =
    'inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <section
      className="print-flow overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
      style={{ '--print-scale': printScale } as CSSProperties}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Process name
          </p>
          <h2 className="text-lg font-bold text-slate-900">
            {processTitle || 'Untitled process'}
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {owner?.trim() ? `Owner unit: ${owner.trim()}` : 'Owner unit: not set'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {folder ? `Folder: ${folder} · ` : ''}
            {steps.length} {steps.length === 1 ? 'step' : 'steps'} across{' '}
            {layout.lanes.length} {layout.lanes.length === 1 ? 'lane' : 'lanes'}
          </p>
        </div>

        <div className="print-hide flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-md border border-slate-300 bg-white">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => clampZoom(z - 0.1))}
                className="inline-flex size-9 items-center justify-center text-slate-600 hover:bg-slate-50"
              >
                <Minus aria-hidden="true" size={15} />
              </button>
              <span className="w-12 text-center text-xs font-medium text-slate-600">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => clampZoom(z + 0.1))}
                className="inline-flex size-9 items-center justify-center text-slate-600 hover:bg-slate-50"
              >
                <Plus aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                aria-label="Reset zoom"
                onClick={() => setZoom(1)}
                className="inline-flex size-9 items-center justify-center border-l border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                <Maximize2 aria-hidden="true" size={15} />
              </button>
            </div>
            <button type="button" onClick={() => window.print()} className={buttonClass}>
              <Printer aria-hidden="true" size={15} />
              Print / Export PDF
            </button>
            <button
              type="button"
              onClick={handleExportPNG}
              disabled={!steps.length || isExporting}
              aria-busy={isExporting}
              className={buttonClass}
            >
              <Download aria-hidden="true" size={15} />
              {isExporting ? 'Exporting PNG...' : 'Export PNG'}
            </button>
          </div>
          {exportMessage && (
            <p
              className={`text-xs ${
                exportMessage.startsWith('PNG export failed') ? 'text-rose-700' : 'text-slate-500'
              }`}
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
          <div
            className="print-scroll overflow-auto rounded border border-slate-300 bg-white"
            style={{ maxHeight: 760 }}
          >
            <div className="print-sizer" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
              <div
                ref={canvasRef}
                className="print-scale relative bg-white"
                style={{
                  width: layout.width,
                  height: layout.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                }}
              >
                {layout.lanes.map((lane, index) => {
                  const tint = LANE_TINTS[index % LANE_TINTS.length]
                  return (
                    <div
                      key={lane.key}
                      className="absolute left-0 right-0 flex border-b border-[#cbd5e1]"
                      style={{ top: lane.top, height: lane.height, backgroundColor: tint.body }}
                    >
                      <div
                        className="flex shrink-0 items-center border-r border-[#cbd5e1] px-4"
                        style={{ width: LABEL_W, backgroundColor: tint.header }}
                      >
                        <div className="min-w-0">
                          {lane.poolName && (
                            <span className="block truncate text-[9px] font-semibold uppercase tracking-wider text-sky-700">
                              {lane.poolName}
                            </span>
                          )}
                          <span className="block break-words text-base font-bold uppercase tracking-wide text-slate-700 leading-snug">
                            {lane.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}

                <svg
                  className="pointer-events-none absolute left-0 top-0"
                  width={layout.width}
                  height={layout.height}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="swimlane-arrow"
                      viewBox="0 0 10 10"
                      refX="10"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
                    </marker>
                  </defs>
                  {layout.edges.map((edge) => (
                    <g key={edge.id}>
                      <path
                        d={getRoundedOrthogonalPath(edge.points, CORNER_RADIUS)}
                        fill="none"
                        stroke="#475569"
                        strokeWidth={1.5}
                        markerEnd="url(#swimlane-arrow)"
                      />
                      {edge.label && (
                        <text
                          x={edge.labelAt.x}
                          y={edge.labelAt.y}
                          textAnchor={edge.labelAnchor}
                          fontSize={14}
                          fontWeight={800}
                          fill={getBranchLabelColor(edge.label)}
                          stroke="#ffffff"
                          strokeWidth={4}
                          paintOrder="stroke"
                        >
                          {edge.label}
                        </text>
                      )}
                    </g>
                  ))}
                </svg>

                {layout.nodes.map((node) => (
                  <NodeView key={node.step.id} node={node} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center rounded border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-slate-500">
            Add process steps to display the flowchart.
          </div>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 sm:px-5">
        <span className="font-semibold text-slate-700">Legend</span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block size-3.5 rounded-full border-2 border-emerald-500 bg-emerald-50" />
          Start
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-3.5 w-5 rounded-sm border border-sky-400 bg-white" />
          Task
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block size-3.5 rotate-45 border-2 border-amber-600 bg-amber-50" />
          Decision
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block size-3.5 rounded-full border-[3px] border-rose-600 bg-rose-50" />
          End
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="font-bold text-emerald-700">Yes</span>
          <span className="font-bold text-rose-700">No</span>
          Branch labels
        </span>
      </footer>
    </section>
  )
}

export default memo(FlowCanvas)