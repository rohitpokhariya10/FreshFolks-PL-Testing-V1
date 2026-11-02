import { describe, expect, it } from 'vitest';
import { classifyLayerEdit, reversedInstruction, stateChanges } from './layerEditIntent.js';

const ops = (instruction: string) => classifyLayerEdit(instruction).operations.sort();
describe('layer-edit intent, read locally from the instruction', () => {
  it.each([
    ['Open both doors.', ['state']],
    ['Close the washing machine door', ['state']],
    ['Pull out the bottom drawer', ['state']],
    ['Raise the left arm', ['state']],
    ['Turn the screen on', ['state']],
    ['Make it red', ['color']],
    ['Turn the door red', ['color']],
    ['Make the inside brighter', ['color']],
    ['Change the handles to brushed copper', ['material']],
    ['Give it a matte black finish', ['color', 'material']],
    ['Remove the sticker on the right door', ['remove']],
    ['Add a water dispenser to the left door', ['add']],
    ['Remove the scratches and clean up the edges', ['clean']],
    ['Replace it with a microwave oven', ['replace']],
    ['Change it into a wooden cabinet', ['replace']],
    ['Make it look newer', ['general']],
    ['Open both doors and make them red', ['color', 'state']],
  ])('%s → %j', (instruction, expected) => expect(ops(instruction)).toEqual(expected));

  it('treats colour and material words without a change request as descriptions, and ignores negated or preserved clauses', () => {
    expect(ops('Open the doors of the black stainless steel refrigerator')).toEqual(['state']);
    expect(ops('Open the door without changing the colour or the finish')).toEqual(['state']);
    expect(ops('Open the door, keep the same silver colour and do not remove the logo')).toEqual(['state']);
    expect(ops('Keep the door open')).toEqual(['state']);
    expect(ops('Don\'t open it, make it blue')).toEqual(['color']);
    expect(ops('Open the glass door')).toEqual(['state']);
  });

  it('keeps identity unless a replacement is asked for, and leaves room only for edits that can grow the outline', () => {
    expect(classifyLayerEdit('Open both doors')).toMatchObject({ preserveIdentity: true, expandsSilhouette: true });
    expect(classifyLayerEdit('Make it red')).toMatchObject({ preserveIdentity: true, expandsSilhouette: false });
    expect(classifyLayerEdit('Remove the scratch')).toMatchObject({ preserveIdentity: true, expandsSilhouette: false });
    expect(classifyLayerEdit('Swap it for a different model')).toMatchObject({ preserveIdentity: false, expandsSilhouette: true });
  });

  it('asks for clarification when the physical change cannot be inferred, including the reported refrigerator instruction', () => {
    expect(classifyLayerEdit('Just open the door and close it out in the refrigerator.').clarification).toMatch(/both open and close/);
    expect(classifyLayerEdit('Fold and unfold it').clarification).toMatch(/both unfold and fold|both fold and unfold/);
    expect(classifyLayerEdit('Open the left door and close the right one').clarification).toBeUndefined();
    for (const vague of ['make it better', 'Improve it.', 'change', '  ']) expect(classifyLayerEdit(vague).clarification).toMatch(/does not say what should change/);
    expect(classifyLayerEdit('Open both doors', { region: true }).clarification).toMatch(/area limit/);
    expect(classifyLayerEdit('Remove the sticker', { region: true }).clarification).toBeUndefined();
  });

  it('names state changes and recognises a reversal of the latest recorded state change only', () => {
    expect(stateChanges('Open both doors')).toEqual(['open']);
    expect(stateChanges('the lower drawer is fine')).toEqual([]);
    expect(stateChanges('Lower the lid')).toEqual(['lower']);
    expect(reversedInstruction('Close the doors', ['Make it red', 'Open both doors'])).toBe(1);
    // A colour edit after opening may have changed the outside too, so no strict comparison is claimed.
    expect(reversedInstruction('Close the doors', ['Open both doors', 'Make the inside brighter'])).toBeUndefined();
    expect(reversedInstruction('Close the doors and make them red', ['Open both doors'])).toBeUndefined();
    expect(reversedInstruction('Close the doors', ['Open both doors and make them red'])).toBeUndefined();
    expect(reversedInstruction('Close the doors', ['Open both doors', undefined])).toBeUndefined();
    expect(reversedInstruction('Close the doors', ['Raise the lid'])).toBeUndefined();
  });
});
