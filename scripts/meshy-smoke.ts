/**
 * Live check for the Meshy session connector (server/generate/meshyCli.ts). Run it yourself, it talks to the real CLI:
 *
 *   npm run meshy:smoke                                   runner + `auth status` + `balance` (all free)
 *   npm run meshy:smoke -- --login                        device login (prints the URL and code to approve in the browser)
 *   npm run meshy:smoke -- --generate "a knight" --yes    the real character pipeline (SPENDS credits)
 *   npm run meshy:smoke -- --generate "a knight"          prints the estimate only
 *
 * Never prints tokens: only the documented status fields, the balance number, task ids and the saved asset path.
 */
import { join } from 'node:path';
import { createMeshyService, MeshyError } from '../server/generate/meshyCli';
import { AssetStore } from '../server/workspace/assets';
import { omniHome } from '../server/workspace/store';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const value = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};

const store = new AssetStore(join(omniHome(), 'library'));
const meshy = createMeshyService({ storeFor: (scope) => (scope === 'personal' ? store : (() => { throw new MeshyError('smoke script saves to the personal library only'); })()) });

async function main() {
  let runner: Awaited<ReturnType<typeof meshy.getRunner>>;
  try {
    runner = await meshy.getRunner();
  } catch (e: any) {
    console.error(`Runner: UNAVAILABLE (${e?.message || e})`);
    process.exit(2);
  }
  console.log(`Runner: ${runner.describe} (CLI ${runner.version})`);

  if (flag('--login')) {
    const v = await meshy.startLogin();
    if (v.state === 'waiting') {
      console.log(`\nOpen ${v.url}\nEnter code ${v.code}\nWaiting for approval (up to 15 minutes)...`);
      for (let i = 0; i < 900; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const now = meshy.loginView();
        if (now.state !== 'waiting') {
          console.log(`Login: ${now.state}${now.message ? ` - ${now.message}` : ''}`);
          break;
        }
      }
    } else console.log(`Login: ${v.state}${v.message ? ` - ${v.message}` : ''}`);
  }

  const auth = await meshy.authStatus();
  console.log(`Auth: authenticated=${auth.authenticated} verified=${auth.verified} source=${auth.source}${auth.hint ? ` hint=${auth.hint}` : ''}`);
  const balance = auth.verified ? await meshy.balance() : undefined;
  console.log(`Balance: ${balance === undefined ? 'unknown' : `${balance} credits`}`);
  if (!auth.authenticated) console.log('Not signed in: run `npm run meshy:smoke -- --login`.');
  else if (!auth.verified) console.log('A session exists but could not be verified (network/server?). No login was started.');

  const prompt = value('--generate');
  if (!prompt) return;
  if (!auth.verified) process.exit(3);
  const est = await meshy.estimate({ prompt });
  console.log(`\nEstimate: ${est.credits === undefined ? 'unknown' : `${est.credits} credits`} (${est.source})`);
  for (const s of est.steps) console.log(`  - ${s}`);
  for (const n of est.notes) console.log(`  note: ${n}`);
  if (!flag('--yes')) {
    console.log('\nNothing was spent. Add --yes to run the pipeline for real.');
    return;
  }
  console.log('\nStarting the character pipeline (this takes several minutes)...');
  const started = await meshy.startCharacter({ prompt, confirm: true });
  let last = '';
  const timer = setInterval(() => {
    const j = meshy.getJob(started.id);
    const line = `${j.stage} ${j.progress}% ${JSON.stringify(j.tasks)}`;
    if (line !== last) console.log(`  ${line}`);
    last = line;
  }, 5000);
  const job = await meshy.waitForJob(started.id);
  clearInterval(timer);
  for (const w of job.warnings) console.log(`warning: ${w}`);
  if (job.status !== 'succeeded') {
    console.error(`\nFAILED (${job.errorCode}): ${job.error}`);
    console.error(`Tasks: ${JSON.stringify(job.tasks)}`);
    process.exit(1);
  }
  for (const a of job.assets) console.log(`Saved: ${(await store.filePath(a.id)).path}  [${a.name}]`);
  console.log(`Clips merged into the GLB: ${job.clips?.join(', ') || 'none (see separate clip assets)'}`);
  console.log(`Credits used: ${job.consumedCredits === null ? 'unknown' : job.consumedCredits} (by stage: ${JSON.stringify(job.creditsByStage)})`);
}

main().catch((e: any) => {
  console.error(`meshy:smoke failed: ${e instanceof MeshyError ? e.message : e?.message || e}`);
  process.exit(1);
});
