import type { Lane, Step } from '../types'

export function makeLaneId(): string {
  return `lane-${crypto.randomUUID().slice(0, 8)}`
}

export function setPinnedLane(lanes: Lane[], laneId: string): Lane[] {
  const isAlreadyPinned = lanes.some((lane) => lane.id === laneId && lane.pinned)
  return lanes.map((lane) => ({
    ...lane,
    pinned: !isAlreadyPinned && lane.id === laneId,
  }))
}

export function deriveLanes(steps: Step[], existing: Lane[]): { lanes: Lane[]; steps: Step[] } {
  const lanesByName = new Map<string, Lane>()
  existing.forEach((lane) => {
    const name = lane.name.trim() || 'Unassigned'
    if (!lanesByName.has(name)) lanesByName.set(name, lane)
  })
  const usedLaneIds = new Set<string>()
  const newLanes: Lane[] = []
  const derivedSteps = steps.map((step) => {
    const name = step.department.trim() || 'Unassigned'
    let lane = lanesByName.get(name)
    if (!lane) {
      lane = { id: makeLaneId(), name }
      lanesByName.set(name, lane)
      newLanes.push(lane)
    }
    usedLaneIds.add(lane.id)
    return step.laneId === lane.id ? step : { ...step, laneId: lane.id }
  })

  const retainedLanes = existing.filter((lane) => usedLaneIds.has(lane.id))
  const retainedIds = new Set(retainedLanes.map((lane) => lane.id))

  return {
    lanes: [...retainedLanes, ...newLanes.filter((lane) => !retainedIds.has(lane.id))],
    steps: derivedSteps,
  }
}
