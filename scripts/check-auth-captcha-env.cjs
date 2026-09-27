#!/usr/bin/env node

// Match Next.js build-time env precedence, including .env.production.local.
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');

const releaseDir = path.resolve(process.argv[2] || process.cwd());
loadEnvConfig(releaseDir, false);

if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()) {
  process.stderr.write('[deploy] NEXT_PUBLIC_TURNSTILE_SITE_KEY is required before building a release.\n');
  process.exit(1);
}

process.stdout.write('[deploy] Auth CAPTCHA site key is configured.\n');
