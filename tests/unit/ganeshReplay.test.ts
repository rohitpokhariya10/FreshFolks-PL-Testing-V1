/**
 * The saved 9:16 Ganesh ji template (approved, regenerated creative) through today's whole pipeline — detection from its
 * saved OpenAI answer, the Seedream Layerize answer it received replayed, preparation, the editor's run — with every
 * check of tests/fixtures/ganeshReplay.ts: no word read again in the background, every word and logo its own layer, none
 * hidden, no object found twice, no blocking check, the layered creative the approved one outside its re-set text.
 * Free and offline. The template and the layers Seedream returned are confidential client material, kept on this machine
 * only (artifacts/, test-results/); elsewhere this is skipped.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const TEMPLATE = 'artifacts/decomposition/protected-templates/pt-0e19aab53f50', LAYERS = 'test-results/ganesh-replay/seedream/pt-0e19aab53f50';
const present = existsSync(`${TEMPLATE}/template.json`) && existsSync(`${TEMPLATE}/prepare-seedream-response.json`) && existsSync(LAYERS) && readdirSync(LAYERS).filter(f => f.endsWith('.png')).length >= 16;

describe('the saved 9:16 Ganesh ji template, replayed through today\'s pipeline', () => {
  it.skipIf(!present)('has a clean background and every word and logo as its own editable layer', () => {
    const out = `test-results/ganesh-replay/unit-${Date.now()}`;
    let log: string;
    try { log = execFileSync(process.execPath, ['--conditions=development', '--import', 'tsx', 'tests/fixtures/ganeshReplay.ts', TEMPLATE, out], { encoding: 'utf8', timeout: 600_000 }); }
    catch (error) { throw new Error(`Ganesh replay process failed: ${String((error as { stdout?: string }).stdout ?? error)}`, { cause: error }); }
    const checks = JSON.parse(readFileSync(`${out}/checks.json`, 'utf8')) as { failures: string[]; notes: string[] };
    expect(checks.failures, log).toEqual([]);
    expect(checks.notes.length).toBeGreaterThanOrEqual(10);
  }, 660_000);
});
