#!/usr/bin/env bash
set -euo pipefail
npx playwright install chromium
node --input-type=module - <<'NODE'
import {chromium} from 'playwright';
const browser = await chromium.launch({headless: true});
await browser.close();
console.log('Chromium launch preflight passed');
NODE
