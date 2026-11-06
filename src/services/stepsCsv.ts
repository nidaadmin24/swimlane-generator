import type { Step, StepType } from '../types'

export const STEP_CSV_HEADERS = [
  'Step ID',
  'Step name',
  'Department',
  'Step type',
  'Predecessor',
  'Branch label',
]

export interface StepCsvResult {
  steps: Step[]
  errors: string[]
}

const allowedStepTypes: StepType[] = [
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
]

function parseCsvRows(text: string, delimiter: string): { cells: string[]; rowNumber: number }[] {
  const rows: { cells: string[]; rowNumber: number }[] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  let lineNumber = 1
  let rowNumber = 1

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (inQuotes) {
        inQuotes = false
      } else if (!cell) {
        inQuotes = true
      } else {
        cell += character
      }
    } else if (character === delimiter && !inQuotes) {
      cells.push(cell)
      cell = ''
    } else if (character === '\n') {
      if (inQuotes) {
        cell += character
        lineNumber += 1
      } else {
        cells.push(cell)
        rows.push({ cells, rowNumber })
        cells = []
        cell = ''
        lineNumber += 1
        rowNumber = lineNumber
      }
    } else {
      cell += character
    }
  }

  cells.push(cell)
  rows.push({ cells, rowNumber })
  return rows
}

export function parseStepsCsv(text: string): StepCsvResult {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const firstNonEmptyLine = normalized.split('\n').find((line) => line.trim() !== '') ?? ''
  const delimiter = firstNonEmptyLine.includes(';') && !firstNonEmptyLine.includes(',') ? ';' : ','
  const rows = parseCsvRows(normalized, delimiter).filter(
    (row) => row.cells.some((cell) => cell.trim() !== ''),
  )
  const headerRow = rows[0]
  if (!headerRow) {
    return { steps: [], errors: [`Missing required header: ${STEP_CSV_HEADERS.join(', ')}`] }
  }

  const headerIndexes = new Map<string, number>(
    headerRow.cells.map((header, index) => [header.trim().toLocaleLowerCase(), index]),
  )
  const missingHeaders = STEP_CSV_HEADERS.filter(
    (header) => !headerIndexes.has(header.toLocaleLowerCase()),
  )
  if (missingHeaders.length) {
    return {
      steps: [],
      errors: [`Missing required header: ${missingHeaders.join(', ')}`],
    }
  }

  const cellFor = (cells: string[], header: string) => {
    const index = headerIndexes.get(header.toLocaleLowerCase())
    return (index === undefined ? '' : cells[index] ?? '').trim()
  }
  const dataRows = rows.slice(1)
  const idsInFile = new Set(
    dataRows.map((row) => cellFor(row.cells, 'Step ID')).filter((id) => id !== ''),
  )
  const seenIds = new Set<string>()
  const steps: Step[] = []
  const errors: string[] = []

  for (const row of dataRows) {
    const id = cellFor(row.cells, 'Step ID')
    const stepName = cellFor(row.cells, 'Step name')
    const department = cellFor(row.cells, 'Department')
    const rawStepType = cellFor(row.cells, 'Step type')
    const stepType = rawStepType || 'Task'
    const rawPredecessor = cellFor(row.cells, 'Predecessor')
    const predecessorId = rawPredecessor.toLocaleLowerCase() === 'none' ? '' : rawPredecessor
    const condition = cellFor(row.cells, 'Branch label')
    const rowErrors: string[] = []

    if (!id) {
      rowErrors.push(`Row ${row.rowNumber}: Step ID is empty.`)
    } else if (seenIds.has(id)) {
      rowErrors.push(`Row ${row.rowNumber}: duplicate Step ID "${id}".`)
    } else {
      seenIds.add(id)
    }

    if (!allowedStepTypes.includes(stepType as StepType)) {
      rowErrors.push(`Row ${row.rowNumber}: invalid step type "${rawStepType}".`)
    }
    if (predecessorId && !idsInFile.has(predecessorId)) {
      rowErrors.push(
        `Row ${row.rowNumber}: predecessor "${predecessorId}" does not match a Step ID in the file.`,
      )
    }
    if (!stepName) {
      rowErrors.push(`Row ${row.rowNumber}: step name is empty.`)
    }

    errors.push(...rowErrors)
    if (rowErrors.length) continue

    steps.push({
      id,
      stepName,
      department,
      stepType: stepType as StepType,
      predecessorId,
      condition,
    })
  }

  return { steps, errors }
}
