import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Lane, Step } from '../src/types'
import { fromFlowModel, toFlowModel } from '../src/services/flowModel'

type FlowchartFixture = {
  title: string
  steps: Step[]
  lanes: Lane[]
}

const fixturePath = fileURLToPath(
  new URL('./fixtures/flowcharts-backup.json', import.meta.url),
)

const expectedLinkCounts: Record<string, number> = {
  'Zakath Implementation Process': 27,
  'Well Process': 31,
  'Post Zakath Audit Process': 14,
  'Zakath Assessment': 20,
}

test('converts backup flowcharts without changing their input', () => {
  test.skip(!existsSync(fixturePath), 'backup fixture not present')

  const flowcharts = JSON.parse(
    readFileSync(fixturePath, 'utf8'),
  ) as FlowchartFixture[]
  expect(flowcharts).toHaveLength(4)

  for (const [title, expectedLinkCount] of Object.entries(expectedLinkCounts)) {
    const flowchart = flowcharts.find((item) => item.title === title)
    expect(flowchart, `Missing flowchart "${title}"`).toBeDefined()
    if (!flowchart) continue

    const original = JSON.stringify(flowchart)
    const first = toFlowModel(flowchart)
    const second = toFlowModel(flowchart)
    const actualLinkCount = first.model.links.length

    console.info(`${title}: ${actualLinkCount} links`)
    expect(actualLinkCount, `Link count for "${title}"`).toBe(expectedLinkCount)
    expect(first.warnings, `Warnings for "${title}"`).toHaveLength(0)
    expect(first.model.steps.map((step) => step.id)).toEqual(
      flowchart.steps.map((step) => step.id),
    )
    expect(second).toEqual(first)
    expect(JSON.stringify(flowchart)).toBe(original)

    const roundTripped = toFlowModel({
      steps: fromFlowModel(first.model).steps,
      lanes: flowchart.lanes,
    })
    const sortedLinks = (links: typeof first.model.links) =>
      links
        .map(({ from, to, label }) => ({ from, to, label }))
        .sort((left, right) =>
          left.from.localeCompare(right.from) ||
          left.to.localeCompare(right.to) ||
          (left.label ?? '').localeCompare(right.label ?? ''),
        )
    expect(roundTripped.model.links.length, `Round-trip link count for "${title}"`)
      .toBe(expectedLinkCount)
    expect(sortedLinks(roundTripped.model.links)).toEqual(sortedLinks(first.model.links))
    expect(roundTripped.warnings, `Round-trip warnings for "${title}"`).toHaveLength(0)
  }

  const audit = flowcharts.find(
    (flowchart) => flowchart.title === 'Post Zakath Audit Process',
  )
  expect(audit, 'Missing Post Zakath Audit Process').toBeDefined()
  if (!audit) return

  const auditModel = toFlowModel(audit).model
  const yesLink = auditModel.links.find(
    (link) => link.from === 'STEP-005' && link.to === 'STEP-006',
  )
  console.info(`STEP-005 -> STEP-006 actual label: ${JSON.stringify(yesLink?.label)}`)
  expect(yesLink, 'Missing link from STEP-005 to STEP-006').toBeDefined()
  expect(yesLink?.label, 'Actual label on STEP-005 -> STEP-006').toBe('Yes')
  expect(
    auditModel.links.some((link) => link.to === 'STEP-010'),
    'STEP-010 should have no incoming link',
  ).toBe(false)
})
