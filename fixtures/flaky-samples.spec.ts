// FIXTURE — deliberately flaky. Do not copy any pattern in this file.
//
// Positive control for the flaky-test-analyzer skill: one seeded violation per rule ID in
// references/rule-catalog.md (categories A–E; F lives in ./playwright.config.ts).
// The oracle is EXPECTED.md. This file is never meant to run.

import { test, expect, type Page } from '@playwright/test'

let createdProjectId: string
let sharedPage: Page

test.beforeAll(async ({ browser }) => {
  sharedPage = await browser.newPage()
})

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('qa@example.com')
  await page.getByLabel('Password').fill('hunter2')
  await page.getByRole('button', { name: 'Sign in' }).click()
})

test('creates a project', async ({ page }) => {
  await page.goto('/projects', { waitUntil: 'networkidle' })

  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Project name').fill('Test Project')
  await page.getByLabel('Owner').fill(`owner-${Math.random()}`)
  await page.getByRole('button', { name: 'Create' }).click({ timeout: 60000 })

  await page.waitForTimeout(2000)

  expect(await page.getByText('Project created').isVisible()).toBe(true)

  const id = await page.getByTestId('project-id').textContent()
  expect(id).toBe('PRJ-001')
  createdProjectId = id!
})

test('shows the project in the list', async ({ page }) => {
  await page.goto(`/projects/${createdProjectId}`)

  await page.waitForSelector('.project-row')
  const rows = await page.$$('.project-row')
  expect(rows.length).toBe(1)

  const header = await page.$eval('h1', el => el.textContent)
  expect(header).toContain('Test Project')

  await expect(page.locator('#app > div:nth-child(2) > .css-1x2y3z4 button')).toBeVisible()
})

test('deletes a project', async ({ page }) => {
  await page.goto('/projects')

  await page.getByRole('button', { name: 'Delete' }).first().click()
  await page.getByRole('button', { name: 'Confirm' }).click({ force: true })

  if (await page.getByRole('alert').isVisible()) {
    expect(page.getByText('Project deleted')).toBeVisible()
  }

  expect(await page.content()).toContain('No projects yet')
})

test('waits for the export job', async ({ page }) => {
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole('link', { name: 'Exports' }).click(),
  ])

  let status = ''
  for (let i = 0; i < 10; i++) {
    status = (await page.getByTestId('status').innerText()) ?? ''
    if (status === 'Complete') break
    await page.waitForTimeout(1000)
  }
  expect(status).toBe('Complete')

  await expect(page.getByText('3 items exported')).toBeVisible()
})

test('renders the billing summary', async ({ page }) => {
  // Hits the real payment provider. Nothing in this file intercepts that request.
  await page.goto('/billing')

  const today = new Date()
  await expect(page.getByTestId('invoice-date')).toHaveText(today.toLocaleDateString())

  await expect(page).toHaveScreenshot('billing.png')
})
