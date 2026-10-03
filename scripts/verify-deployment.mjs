import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const [mode, target, commit] = process.argv.slice(2);
if (!['manifest', 'check'].includes(mode) || !target || !/^[a-f0-9]{40}$/.test(commit ?? '')) {
  throw new Error('Usage: node scripts/verify-deployment.mjs manifest <dist-directory> <commit> | check <site-url> <commit>');
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (mode === 'manifest') {
  const names = ['index.html', 'favicon.svg', 'site.webmanifest', ...(await readdir(`${target}/assets`)).map((name) => `assets/${name}`)];
  const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, digest(await readFile(`${target}/${name}`))])));
  await writeFile(`${target}/deployment.json`, JSON.stringify({ commit, files }) + '\n');
  console.log(`Prepared deployment verification for ${commit}: ${names.length} files.`);
} else {
  const site = new URL(target.endsWith('/') ? target : `${target}/`);
  if (site.protocol !== 'https:' && !(site.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(site.hostname))) {
    throw new Error('Use an HTTPS site URL (HTTP is allowed only for local validation).');
  }
  const get = async (name) => {
    const url = new URL(name, site);
    url.searchParams.set('release', commit);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  // Pages/CDN publication can briefly serve files from the previous release.
  for (let attempt = 1; ; attempt++) {
    try {
      const manifest = JSON.parse((await get('deployment.json')).toString('utf8'));
      if (manifest.commit !== commit) throw new Error(`Expected release ${commit}, received ${manifest.commit}`);
      const entries = Object.entries(manifest.files ?? {});
      if (!entries.some(([name]) => name === 'index.html') || !entries.some(([name]) => /^assets\/.*\.js$/.test(name))) {
        throw new Error('Release manifest is missing the entry page or JavaScript assets.');
      }
      await Promise.all(entries.map(async ([name, expected]) => {
        if (!/^(?:index\.html|favicon\.svg|site\.webmanifest|assets\/[A-Za-z0-9._-]+)$/.test(name) || !/^[a-f0-9]{64}$/.test(expected)) {
          throw new Error('Invalid release manifest entry.');
        }
        if (digest(await get(name)) !== expected) throw new Error(`${name}: published bytes differ from the build`);
      }));
      console.log(`Verified published release ${commit}: ${entries.length} files match the build at ${site.href}`);
      break;
    } catch (error) {
      if (attempt === 10) throw error;
      console.log(`Publication check ${attempt}/10: ${error.message}; retrying in 3 seconds.`);
      await delay(3000);
    }
  }
}
