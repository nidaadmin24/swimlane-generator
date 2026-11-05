import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const USER_ID = '8700dd59-3acf-422d-a6a7-1cc9b142efed'
// supabase-js stores the session under sb-<first part of hostname>-auth-token
const STORAGE_KEY = 'sb-127-auth-token'
const ZAKATH_ID = '11111111-1111-4111-8111-111111111111'
const FINANCE_ID = '22222222-2222-4222-8222-222222222222'

type Row = {
  id: string
  title: string
  folder: string
  steps: unknown[]
  user_id: string
  created_at: string
}

const sampleSteps = [
  { id: 'STEP-001', stepName: 'Start', department: 'Client', stepType: 'Start Event', predecessorId: '', condition: '' },
  { id: 'STEP-002', stepName: 'Review', department: 'Finance', stepType: 'Task', predecessorId: 'STEP-001', condition: '' },
  { id: 'STEP-003', stepName: 'Done', department: 'Finance', stepType: 'End Event', predecessorId: 'STEP-002', condition: '' },
]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
}

function seedRows(): Row[] {
  return [
    {
      id: ZAKATH_ID,
      title: 'Zakath Assessment',
      folder: 'Zakat',
      steps: sampleSteps,
      user_id: USER_ID,
      created_at: new Date().toISOString(),
    },
    {
      id: FINANCE_ID,
      title: 'Expense Approval',
      folder: 'Finance',
      steps: sampleSteps,
      user_id: USER_ID,
      created_at: new Date().toISOString(),
    },
  ]
}

async function mockSupabase(page: Page, rows: Row[]) {
  const user = {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'adminnida24@gmail.com',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  const session = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    user,
  }

  // Put a signed-in session into localStorage before the app loads.
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: session },
  )

  await page.route('**/auth/v1/user**', (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders })
    }
    return route.fulfill({
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(user),
    })
  })

  await page.route('**/rest/v1/process_diagrams**', async (route) => {
    const request = route.request()
    const method = request.method()

    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders })
    }

    const url = new URL(request.url())
    const id = url.searchParams.get('id')?.replace(/^eq\./, '') ?? null
    const wantsObject = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    if (method === 'GET') {
      return json(200, rows)
    }

    if (method === 'POST') {
      const body = request.postDataJSON() as Partial<Row>
      const row: Row = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        user_id: USER_ID,
        folder: 'General',
        title: '',
        steps: [],
        ...body,
      }
      rows.push(row)
      return json(201, wantsObject ? row : [row])
    }

    if (method === 'PATCH') {
      const row = rows.find((r) => r.id === id)
      if (row) Object.assign(row, request.postDataJSON())
      return json(200, wantsObject ? row : [row].filter(Boolean))
    }

    if (method === 'DELETE') {
      const index = rows.findIndex((r) => r.id === id)
      if (index !== -1) rows.splice(index, 1)
      return route.fulfill({ status: 204, headers: corsHeaders })
    }

    return route.continue()
  })
}

test.describe('folders', () => {
  test('groups saved flowcharts by folder in the Load dropdown', async ({ page }) => {
    await mockSupabase(page, seedRows())
    await page.goto('/')

    const select = page.getByLabel('Load Flowchart')
    await expect(select.locator('option', { hasText: 'Zakath Assessment' })).toHaveCount(1)

    const labels = await select
      .locator('optgroup')
      .evaluateAll((groups) => groups.map((group) => group.getAttribute('label')))
    expect(labels).toEqual(['Finance', 'Zakat'])
  })

  test('saves a new flowchart into the folder typed in the Folder box', async ({ page }) => {
    const rows = seedRows()
    await mockSupabase(page, rows)
    await page.goto('/')

    await page.getByLabel('Folder', { exact: true }).fill('Finance')

    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/rest/v1/process_diagrams'),
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const request = await postPromise

    expect(request.postDataJSON()).toMatchObject({ folder: 'Finance' })
    await expect(page.getByText('Flowchart saved successfully.')).toBeVisible()
    expect(rows.at(-1)?.folder).toBe('Finance')
  })

  test('loading a flowchart fills in its folder', async ({ page }) => {
    await mockSupabase(page, seedRows())
    await page.goto('/')

    await page.getByLabel('Load Flowchart').selectOption(FINANCE_ID)

    await expect(page.getByLabel('Folder', { exact: true })).toHaveValue('Finance')
    await expect(page.getByLabel('Process Title')).toHaveValue('Expense Approval')
  })

  test('deleting a flowchart removes it from the dropdown', async ({ page }) => {
    const rows = seedRows()
    await mockSupabase(page, rows)
    await page.goto('/')

    const select = page.getByLabel('Load Flowchart')
    await select.selectOption(FINANCE_ID)

    const deletePromise = page.waitForRequest(
      (req) => req.method() === 'DELETE' && req.url().includes(FINANCE_ID),
    )
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await deletePromise

    await expect(select.locator('option', { hasText: 'Expense Approval' })).toHaveCount(0)
    expect(rows.find((r) => r.id === FINANCE_ID)).toBeUndefined()
  })
})