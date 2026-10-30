/**
 * An element analysis that outlives its wait (gpt-5.6-sol, background mode), collected with its saved response ID — free,
 * no network (a fake Responses client):
 *
 * - still processing: the template says so, with OpenAI's own status (in_progress), when it was submitted and last
 *   checked; it is never marked done, and checking again sends no new request;
 * - completed: "Retrieve existing request" collects the answer of the one request that was sent: products and
 *   characters reach the review (one AI call, billed once), and Review → Choose works;
 * - failed at OpenAI: its own error is shown, it is no longer offered for retrieval, and only an explicitly approved
 *   new request can replace it.
 */
import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import { liveProductAnalyzer } from '../../server/src/decomposition/protectedTemplates/product/analyzer.js';
import { PRODUCT_SCENE_ANSWER, productPosterPng } from '../../server/src/decomposition/protectedTemplates/product/productPoster.fixture.js';
import { setup, type View } from '../../server/src/decomposition/protectedTemplates/product/productServer.fixture.js';

type Recovery = { retrievable: boolean; job?: { status: string; startedAt: string; checkedAt?: string } };
/** OpenAI holding one background response: `in_progress` until `finish` says how it ended. */
function backgroundClient() {
  const state = { creates: 0, retrieves: 0, end: undefined as undefined | 'completed' | 'failed' };
  const response = (): object => state.end === 'completed'
    ? { id: 'resp_saved', status: 'completed', output: [], output_text: JSON.stringify({ ...PRODUCT_SCENE_ANSWER, text_overlays: [], words: [] }), usage: { input_tokens: 4200, output_tokens: 9000 } }
    : state.end === 'failed' ? { id: 'resp_saved', status: 'failed', output: [], output_text: '', usage: null, error: { code: 'server_error', message: 'The model failed to generate a response.' } }
      : { id: 'resp_saved', status: 'in_progress', output: [], output_text: '', usage: null };
  const client = { responses: {
    create: (async () => { state.creates++; return response(); }) as unknown as OpenAI['responses']['create'],
    retrieve: (async (id: string) => { state.retrieves++; expect(id).toBe('resp_saved'); return response(); }) as unknown as OpenAI['responses']['retrieve'],
  } as OpenAI['responses'] };
  return { state, analyzer: liveProductAnalyzer({ model: 'gpt-5.6-sol', client, timeoutMs: 400 }) };
}
const recoveryOf = (v: View) => (v as View & { recovery: Recovery }).recovery;

describe('collecting an element analysis that is still processing', { timeout: 60_000 }, () => {
  it('shows the real OpenAI status while it runs; retrieving the saved request collects the answer (no new request); Review → Choose works', async () => {
    const ai = backgroundClient(), s = await setup({ analyzer: ai.analyzer });
    try {
      const made = await s.form('', await productPosterPng(), { name: 'Pending analysis' });
      let v = await s.detected(made.body.template.id);
      const id = v.template.id;
      // Still processing: said as it is, never as done, and offered for a free retrieval.
      expect(v.product.detection?.ai).toMatchObject({ status: 'failed', code: 'PENDING' });
      expect(v.product.detection?.ai?.error).toContain('in_progress');
      expect(v.counts.products + v.counts.characters).toBe(0);
      expect(recoveryOf(v)).toMatchObject({ retrievable: true, job: { status: 'in_progress' } });
      expect(recoveryOf(v).job?.checkedAt).toBeTruthy();
      // A new AI request is refused while the first may still finish (and be billed).
      const again = await s.send<{ error?: { code?: string } }>('POST', `/${id}/detect`, { force: true, useAi: true });
      expect(again.status === 202 ? (await s.detected(id)).product.detection?.error : JSON.stringify(again.body)).toContain('Retrieve the existing request');
      // Checking again while it still runs: the same request, nothing new submitted.
      expect((await s.send('POST', `/${id}/detect`, { force: true, useAi: false, recover: true })).status).toBe(202);
      v = await s.detected(id);
      expect(v.product.detection?.ai?.code).toBe('PENDING');
      expect(ai.state.creates).toBe(1);

      // OpenAI finishes: the saved request's answer is collected.
      ai.state.end = 'completed';
      const checks = ai.state.retrieves;
      expect((await s.send('POST', `/${id}/detect`, { force: true, useAi: false, recover: true })).status).toBe(202);
      v = await s.detected(id);
      expect(ai.state.retrieves).toBeGreaterThan(checks);
      expect(ai.state.creates).toBe(1);
      expect(v.product.detection).toMatchObject({ status: 'done', ai: { status: 'done', model: 'gpt-5.6-sol' } });
      expect(v.counts.products).toBeGreaterThan(0);
      expect(v.counts.characters).toBeGreaterThan(0);
      expect(v.stage).toBe('review');
      expect(v.product.activity.aiCalls).toBe(1);
      expect(v.product.activity.costUsd).toBeGreaterThan(0);
      expect(recoveryOf(v).job?.status).toBe('completed');

      // Review → Choose.
      v = (await s.send('PUT', `/${id}/review`, { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ ...o, accepted: true })), texts: [], logos: [], dismissMissingText: true })).body;
      const products = v.product.objects.filter(o => o.kind === 'product' && !o.hidden);
      expect(products.length).toBeGreaterThan(0);
      const chosen = await s.send('PUT', `/${id}/selection`, { expectedRevision: v.template.revision, objects: v.product.objects.map(o => ({ id: o.id, decompose: o.id === products[0].id })), logos: [] });
      expect(chosen.status).toBe(200);
      expect(chosen.body.product.objects.find(o => o.id === products[0].id)?.decompose).not.toBe(false);
    } finally { await s.close(); }
  });

  it('a request OpenAI ended as failed shows its own error, is not offered for retrieval, and is replaced only on approval', async () => {
    const ai = backgroundClient(), s = await setup({ analyzer: ai.analyzer });
    try {
      const made = await s.form('', await productPosterPng(), { name: 'Failed analysis' });
      let v = await s.detected(made.body.template.id);
      const id = v.template.id;
      ai.state.end = 'failed';
      expect((await s.send('POST', `/${id}/detect`, { force: true, useAi: false, recover: true })).status).toBe(202);
      v = await s.detected(id);
      expect(v.product.detection?.status).toBe('failed');
      expect(v.product.detection?.ai?.error).toContain('The model failed to generate a response.');
      expect(recoveryOf(v)).toMatchObject({ retrievable: false, job: { status: 'failed' } });
      expect(ai.state.creates).toBe(1);
      // The safe retry: one new request, sent only when explicitly approved.
      ai.state.end = 'completed';
      expect((await s.send('POST', `/${id}/detect`, { force: true, useAi: true, newRequest: true })).status).toBe(202);
      v = await s.detected(id);
      expect(ai.state.creates).toBe(2);
      expect(v.product.detection?.ai?.status).toBe('done');
      expect(v.counts.products).toBeGreaterThan(0);
    } finally { await s.close(); }
  });
});
