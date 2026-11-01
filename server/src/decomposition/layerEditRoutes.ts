import express, { type Router } from 'express';
import { createLayerEdits } from './layerEdit.js';
import { RunError } from './layerizeExperiment.js';
const publicError = (e: unknown) => e instanceof RunError ? e : new RunError('LAYER_EDIT_UNAVAILABLE', 'Layer editing could not read or save its data. No edit was applied. If generation was submitted, check its status before trying again.');
/** Registered after the existing experiment access guard. Request bodies are capped by the app's JSON parser. */
export function registerLayerEditRoutes(router: Router, options: Parameters<typeof createLayerEdits>[0]) {
  const edits = createLayerEdits(options);
  router.use('/layer-edits', express.json({ limit: '8kb' }));
  router.post('/layer-edits/estimate', async (req, res, next) => { try { res.json(await edits.estimate(req.body ?? {})); } catch (e) { next(publicError(e)); } });
  router.post('/layer-edits', async (req, res, next) => { try { res.json(await edits.generate(req.body ?? {})); } catch (e) { next(publicError(e)); } });
  // `revision` (optional): the editor's current saved creative revision. The edit's layer and source image never come from it.
  const revisionOf = (value: unknown) => typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : typeof value === 'number' ? value : undefined;
  router.get('/layer-edits/:id', async (req, res, next) => { try { res.setHeader('Cache-Control', 'no-store'); res.json(await edits.status(req.params.id, revisionOf(req.query.revision))); } catch (e) { next(publicError(e)); } });
  router.post('/layer-edits/:id/apply', async (req, res, next) => { try { res.json(await edits.apply(req.params.id, revisionOf(req.body?.revision))); } catch (e) { next(publicError(e)); } });
  router.post('/layer-edits/:id/discard', async (req, res, next) => { try { res.json(await edits.discard(req.params.id)); } catch (e) { next(publicError(e)); } });
}
