// Creates the dedicated TEST company account through the normal live Sign Up form.
// EMAIL / PASSWORD from the environment (Secret Manager); never printed.
import { chromium } from 'playwright';
const [APP] = process.argv.slice(2);
const b = await chromium.launch(); const page = await (await b.newContext()).newPage();
try {
  await page.goto(`${APP}/auth`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Sign Up' }).click();
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Company' }).click();
  await page.getByPlaceholder('Company Name').fill('ProofLab TEST Company Smoke');
  const tab = page.getByRole('tabpanel');
  await tab.locator('input[type="email"]').fill(process.env.EMAIL);
  await tab.locator('input[type="password"]').first().fill(process.env.PASSWORD);
  await tab.getByRole('button', { name: /Create Account/ }).click();
  await page.waitForTimeout(8000);
  console.log('after sign up:', new URL(page.url()).pathname, '|', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160));
} catch (e) { console.log('ERROR', e.message.slice(0, 200)); process.exitCode = 1; }
finally { await b.close(); }
