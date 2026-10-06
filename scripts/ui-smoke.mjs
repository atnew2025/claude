#!/usr/bin/env node
/**
 * Browser smoke test: serves the repo, loads the visualizer in Chromium, clicks
 * through every view in light and dark themes at desktop and phone widths, and
 * fails on console errors or horizontal overflow. Screenshots go to
 * $SCREENSHOT_DIR (default ./screenshots).
 *
 * Requires Playwright (`npm i -D playwright` or a global install).
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return import(join(root, 'playwright', 'index.mjs'));
  }
}

const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.env.SCREENSHOT_DIR ?? join(here, '..', 'screenshots'));
mkdirSync(out, { recursive: true });
const port = 5000 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, [join(here, 'serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'pipe' });
await new Promise((ok) => server.stdout.once('data', ok));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [];
const modes = ['plan', 'compare', 'race', 'pareto', 'recon'];

try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 400, height: 860 }]]) {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport, colorScheme: scheme });
      // Web fonts are blocked below to keep the run offline; ignore those load errors.
      page.on('console', (m) => {
        if (m.type() !== 'error' || /fonts\.(googleapis|gstatic)/.test(m.location().url ?? '')) return;
        failures.push(`${label}/${scheme} console: ${m.text()}`);
      });
      page.on('pageerror', (e) => failures.push(`${label}/${scheme} page error: ${e.message}`));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      await page.goto(`http://localhost:${port}/`);
      await page.waitForSelector('#results .who, #results h2');
      for (const mode of modes) {
        await page.click(`[data-mode="${mode}"]`);
        await page.waitForTimeout(mode === 'pareto' ? 2500 : 1800);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) failures.push(`${label}/${scheme}/${mode}: page scrolls horizontally by ${overflow}px`);
        await page.screenshot({ path: join(out, `${label}-${scheme}-${mode}.png`), fullPage: label === 'desktop' });
      }
      // Exercise the editor: place a turret, inspect it, switch scenario.
      await page.click('[data-mode="plan"]');
      await page.click('[data-tool="turret"]');
      await page.locator('#map').scrollIntoViewIfNeeded();
      const box = await page.locator('#map').boundingBox();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.waitForTimeout(300);
      if (!(await page.locator('#inspector .editor').count())) failures.push(`${label}/${scheme}: attacker editor did not open`);
      await page.selectOption('#scenario', 'gallery');
      await page.waitForTimeout(4500);
      await page.screenshot({ path: join(out, `${label}-${scheme}-gallery.png`) });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  console.error(`UI smoke test failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`UI smoke test passed. Screenshots in ${out}`);
