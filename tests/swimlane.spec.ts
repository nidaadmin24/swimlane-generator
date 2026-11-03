import { expect, test, type Page } from '@playwright/test'
import type { ProcessDiagram } from '../src/types'

const testUser = {
  id: 'playwright-user',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'flowchart-test@example.com',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
}

async function mockSupabase(page: Page, options: { loadError?: boolean } = {}) {
  const diagrams: ProcessDiagram[] = []
  let nextId = 1
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': '*',
  }

  await page.route('**/auth/v1/token*', (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders })
    }
    return route.fulfill({
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        access_token: 'playwright-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'playwright-refresh-token',
        user: testUser,
      }),
    })
  })

  await page.route('**/auth/v1/logout*', (route) =>
    route.fulfill({ status: 204, headers: corsHeaders, body: '' }),
  )

  await page.route('**/rest/v1/process_diagrams*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders })
      return
    }

    if (request.method() === 'GET') {
      if (options.loadError) {
        await route.fulfill({
          status: 500,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({
            code: '42P01',
            message: 'process_diagrams table is unavailable',
            details: '',
            hint: '',
          }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        headers: {
          ...corsHeaders,
          'content-type': 'application/json',
          'content-range': `0-${Math.max(diagrams.length - 1, 0)}/${diagrams.length}`,
        },
        body: JSON.stringify(diagrams),
      })
      return
    }

    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Pick<ProcessDiagram, 'title' | 'steps'>
      const diagram: ProcessDiagram = {
        id: `diagram-${nextId++}`,
        title: body.title,
        steps: body.steps,
        user_id: testUser.id,
        created_at: new Date().toISOString(),
      }
      diagrams.push(diagram)
      await route.fulfill({
        status: 201,
        headers: {
          ...corsHeaders,
          'content-type': 'application/json',
          'content-range': `0-0/${diagrams.length}`,
        },
        body: JSON.stringify(diagram),
      })
      return
    }

    const idFilter = url.searchParams.get('id')
    const id = idFilter?.replace(/^eq\./, '')
    const index = diagrams.findIndex((diagram) => diagram.id === id)

    if (request.method() === 'PATCH') {
      if (index < 0) {
        await route.fulfill({
          status: 404,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: '{"message":"Not found"}',
        })
        return
      }
      const body = request.postDataJSON() as Partial<ProcessDiagram>
      diagrams[index] = { ...diagrams[index], ...body }
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(diagrams[index]),
      })
      return
    }

    if (request.method() === 'DELETE') {
      if (index >= 0) diagrams.splice(index, 1)
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' })
      return
    }

    await route.fulfill({ status: 405, headers: corsHeaders, body: '' })
  })
}

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Email address').fill(testUser.email)
  await page.getByLabel('Password').fill('playwright-test-password')
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(
    page.getByRole('heading', { name: 'Automated Swimlane Flowchart Generator' }),
  ).toBeVisible()
}

test('shows the login screen when signed out', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled()
})

test('successful sign-in opens the authenticated workspace', async ({ page }) => {
  await mockSupabase(page)
  await signIn(page)

  await expect(page.getByText(testUser.email)).toBeVisible()
  await expect(page.locator('.react-flow')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible()
})

test('updates the flowchart automatically when process steps change', async ({ page }) => {
  await mockSupabase(page)
  await signIn(page)

  await page.getByLabel('Step name for STEP-001').fill('Revised request')
  await expect(page.locator('.react-flow')).toContainText('Revised request')

  await page.getByLabel('Step type for STEP-001').selectOption('Task')
  await expect(page.locator('.react-flow')).toContainText('Task · STEP-001')
})

test('keeps parallel decision outcomes in numerical step order', async ({ page }) => {
  await mockSupabase(page)
  await signIn(page)

  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Add Row' }).click()
  }

  for (let stepNumber = 1; stepNumber <= 9; stepNumber += 1) {
    await page.getByLabel(`Department for STEP-${String(stepNumber).padStart(3, '0')}`).fill('Finance')
  }

  await page.getByLabel('Step type for STEP-003').selectOption('Task')
  for (let stepNumber = 4; stepNumber <= 7; stepNumber += 1) {
    const currentId = `STEP-${String(stepNumber).padStart(3, '0')}`
    const predecessorId = `STEP-${String(stepNumber - 1).padStart(3, '0')}`
    await page.getByLabel(`Predecessor for ${currentId}`).selectOption(predecessorId)
  }
  await page.getByLabel('Step type for STEP-007').selectOption('Decision Point')
  await page.getByLabel('Condition for STEP-007').fill('Yes / No')
  await page.getByLabel('Predecessor for STEP-008').selectOption('STEP-007')
  await page.getByLabel('Predecessor for STEP-009').selectOption('STEP-007')

  const positions = await page.locator('.react-flow__node[data-id^="STEP-"]').evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const id = node.getAttribute('data-id') ?? ''
        const x = Number.parseFloat((node as HTMLElement).style.transform.match(/translate\(([-\d.]+)px/)?.[1] ?? '')
        return { id, x }
      })
      .filter(({ id }) => /^STEP-\d+$/.test(id))
      .sort((left, right) => Number(left.id.slice(5)) - Number(right.id.slice(5))),
  )

  expect(positions).toHaveLength(9)
  for (let index = 1; index < positions.length; index += 1) {
    expect(positions[index].x).toBeGreaterThan(positions[index - 1].x)
  }
})

test('shows the database load error and keeps the workspace available', async ({ page }) => {
  await mockSupabase(page, { loadError: true })
  await signIn(page)

  await expect(page.getByRole('alert')).toContainText(
    'Could not load saved flowcharts: process_diagrams table is unavailable',
  )
  await expect(page.locator('.react-flow')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Load Flowchart' })).toHaveText('No saved flowcharts')
})

test('saves and deletes a flowchart', async ({ page }) => {
  await mockSupabase(page)
  await signIn(page)

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Flowchart saved successfully.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Flowchart deleted.')).toBeVisible()
  await expect(page.getByLabel('Process title')).toHaveValue('')
  await expect(page.getByText('Add process steps to display the flowchart.')).toBeVisible()
})

test('exports the flowchart as a titled PNG', async ({ page }) => {
  await mockSupabase(page)
  await signIn(page)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('Customer Onboarding Flow.png')
  await expect(page.getByText('PNG exported successfully.')).toBeVisible()
})

test('new process confirms and clears the current process', async ({ page }) => {
  await mockSupabase(page)
  await signIn(page)

  const titleInput = page.getByLabel('Process title')
  await expect(page.getByRole('status', { name: 'Document status: New Diagram' })).toBeVisible()
  await titleInput.fill('Unsaved process')
  await expect(page.getByRole('status', { name: 'Document status: Unsaved Changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Add Row' }).click()

  const cancelDialog = page.waitForEvent('dialog')
  const cancelClick = page.getByRole('button', { name: 'New' }).click()
  const confirmation = await cancelDialog
  expect(confirmation.type()).toBe('confirm')
  await confirmation.dismiss()
  await cancelClick

  await expect(titleInput).toHaveValue('Unsaved process')
  await expect(page.locator('tbody tr')).toHaveCount(4)

  const acceptDialog = page.waitForEvent('dialog')
  const acceptClick = page.getByRole('button', { name: 'New' }).click()
  await (await acceptDialog).accept()
  await acceptClick

  await expect(titleInput).toHaveValue('')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByLabel('Step name for STEP-001')).toHaveValue('')
  await expect(page.getByText('Add process steps to display the flowchart.')).toBeVisible()
  await expect(page.getByRole('status', { name: 'Document status: New Diagram' })).toBeVisible()
})
