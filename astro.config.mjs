import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { execSync } from 'node:child_process';

// The commit this build came from, shown in Manage → Settings next to the version number.
// Cloudflare's Git builds set WORKERS_CI_COMMIT_SHA; otherwise ask git, and leave it blank if that fails.
function commit() {
  const ci = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || '';
  if (ci) return ci.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}

// Which GitHub repository this copy was built from ("you/myshelf"), so a new copy's Source link and Updates
// point at its own fork without anyone typing it in. Cloudflare's Git builds work from a clone, so its remote
// says; blank if it can't be read (then Settings' Source code link, or a GITHUB_REPO variable, is used).
function repo() {
  try {
    const url = execSync('git config --get remote.origin.url', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const m = url.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    return m ? `${m[1]}/${m[2]}` : '';
  } catch { return ''; }
}

// Pages render on request from the D1 database, so saves show up immediately (no rebuilds).
// Static files (CSS, JS, fonts, old covers) are still served straight from Cloudflare Pages.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
    platformProxy: { enabled: true },
  }),
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: {
    define: {
      __MYSHELF_COMMIT__: JSON.stringify(commit()),
      __MYSHELF_REPO__: JSON.stringify(repo()),
      __MYSHELF_BUILT__: JSON.stringify(new Date().toISOString()),
    },
  },
});
