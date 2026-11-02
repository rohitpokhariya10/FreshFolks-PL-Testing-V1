/**
 * What an AI layer-edit instruction asks for, read locally (no AI call, no product names). It decides the framing, the
 * prompt's allowed/not-allowed changes and which identity checks apply. The default is always: keep the product's
 * identity and change only what was asked. Only an explicit replacement turns identity preservation off.
 */
import type { LayerEditIntent, LayerEditOperation } from '@frameflow/shared';

const COLOURS = 'red|green|blue|yellow|orange|purple|violet|pink|magenta|cyan|teal|turquoise|navy|maroon|burgundy|beige|cream|ivory|brown|tan|black|white|grey|gray|silver|gold|golden|bronze|champagne|graphite|charcoal|rose|olive|mint|lavender|lilac|peach|coral|khaki|indigo|aqua|crimson|scarlet|emerald|sapphire|ruby';
const COLOUR_WORD = new RegExp(`\\b(?:${COLOURS})\\b|#[0-9a-f]{6}\\b|\\b(?:colou?r|colou?red|hue|shade|pastel|monochrome)\\b`);
/** Colour changes that need no other cue. */
const COLOUR_CHANGE = /\b(?:recolou?r|repaint|tint|dye|darker|lighter|brighter|dimmer|darken|lighten|brighten)\b/;
const MATERIAL_WORD = /\b(?:matte|matt|glossy|gloss|satin|chrome|chromed|metallic|brushed|stainless|steel|wood|wooden|leather|fabric|glass|plastic|marble|velvet|copper|brass|aluminium|aluminum|ceramic|carbon|material|finish|texture|textured)\b/;
/** A colour or material word is a change only with a change cue; otherwise it describes the product ("the black door"). */
const CHANGE_CUE = /\b(?:make|change|paint|turn|switch|convert|give|apply|use|coat|cover|swap|into|instead|in (?:a |an )?(?:\w+ )?(?:colou?r|finish|material|shade)|to (?:a |an )?(?:\w+ )?(?:colou?r|finish|material))\b/;
// A clean-up names the defect it removes, so "remove the scratch" is a repair, not removing a product feature.
const CLEAN = /\b(?:clean(?: up)?|fix|repair|restore|sharpen|denoise|de-noise|deblur|tidy|smooth(?:en)?(?: out)?(?: the)? edges?)\b|\b(?:scratch(?:es)?|smudges?|dust|noise|artifacts?|artefacts?|blemish(?:es)?|stains?|glare|watermarks?|halos?|fringes?|fringing|jagged|blurry|pixelated)\b/;
const REPLACE = /\b(?:replace|swap|substitute|exchange)\b|\binstead of\b|\b(?:turn|change|transform|convert)\s+(?:it|this|that|the \w+)\s+in(?:to)?\s+(?:an?|the)\b|\bmake\s+(?:it|this|that)\s+(?:an?\s+)?(?:different|another|new)\b|\bdifferent\s+(?:model|product|brand|one|object|design)\b/;
const REMOVE = /\b(?:remove|delete|erase|take\s+(?:off|away|out)|get rid of|hide)\b/;
const ADD = /\b(?:add|put|place|attach|insert|include|mount|hang|stick)\b/;
/** Physical state changes, with the opposite of each so contradictions and reversals can be recognised. */
const STATES: { name: string; pattern: RegExp; opposite: string }[] = [
  { name: 'open', pattern: /\b(?:open|opened|opening|ajar|unlatch)\b|\bpull(?:ed)?\s+(?:it\s+|them\s+)?(?:out|open)\b|\bslide\s+(?:it\s+|them\s+)?(?:out|open)\b/, opposite: 'close' },
  { name: 'close', pattern: /\b(?:close|closed|closing|shut|shutting|latch)\b|\bpush(?:ed)?\s+(?:it\s+|them\s+)?in\b|\bslide\s+(?:it\s+|them\s+)?(?:in|shut)\b/, opposite: 'open' },
  { name: 'unfold', pattern: /\b(?:unfold|unfolded|unroll|unrolled|deploy|deployed)\b/, opposite: 'fold' },
  { name: 'fold', pattern: /\b(?:fold|folded|collapse|collapsed|roll up)\b/, opposite: 'unfold' },
  { name: 'raise', pattern: /\b(?:raise|raised|lift|lifted|tilt up|flip up|pop up)\b/, opposite: 'lower' },
  { name: 'lower', pattern: /\blower(?:ed)?\s+(?:it|them|the|its|his|her|their)\b|\b(?:tilt down|flip down)\b/, opposite: 'raise' },
  { name: 'extend', pattern: /\b(?:extend|extended|stretch|stretched|telescope)\b/, opposite: 'retract' },
  { name: 'retract', pattern: /\b(?:retract|retracted|withdraw)\b/, opposite: 'extend' },
  { name: 'unzip', pattern: /\bunzip(?:ped)?\b/, opposite: 'zip' },
  { name: 'zip', pattern: /\bzip(?:ped)?\s+(?:it\s+)?up\b/, opposite: 'unzip' },
  { name: 'switch-on', pattern: /\b(?:turn|switch|light)(?:ed)?\s+(?:it\s+|them\s+|the\s+\w+\s+)?on\b|\blit up\b|\bglowing\b/, opposite: 'switch-off' },
  { name: 'switch-off', pattern: /\b(?:turn|switch)(?:ed)?\s+(?:it\s+|them\s+|the\s+\w+\s+)?off\b/, opposite: 'switch-on' },
  // Movements without an opposite here: a pose or a part's angle ("turn the door red" is a colour change, not a movement).
  { name: 'move', pattern: new RegExp(`\\b(?:rotate|rotated|spin|swivel|swing|swung|bend|bent|wave|waving|recline|reclined|kneel|kneeling)\\b|\\bturn\\s+(?:around|sideways|left|right)\\b|\\bturn\\s+(?:the|its|his|her|their)\\s+\\w+\\b(?!\\s+(?:${COLOURS}|in|into|to|on|off)\\b)`), opposite: '' },
];
/** Words that tell two opposite state changes apart (open the left door and close the right one). */
const DISTINCT_PARTS = /\b(?:left|right|top|bottom|upper|lower|front|back|rear|first|second|third|middle|inner|outer|other)\b/g;
const VAGUE = /^(?:please\s+)?(?:just\s+)?(?:make\s+(?:it|this)\s+(?:look\s+)?)?(?:better|nicer|cool(?:er)?|good|great|perfect|pretty|prettier|beautiful|awesome|attractive|amazing|premium|modern)$|^(?:please\s+)?(?:just\s+)?(?:improve|enhance|edit|change|update|fix|redo|do something)(?:\s+(?:it|this|that))?$/;
/** A negation removes its clause entirely; a preservation statement ("keep the colour") never asks for a change. */
const NEGATION = /\b(?:without|don't|do not|dont|never|not|no)\b[^.,;!?]*/g;
const PRESERVE = /\b(?:keep(?:ing)?|preserv(?:e|ing)|leave|leaving|maintain(?:ing)?|retain(?:ing)?|same)\b[^.,;!?]*/g;

const normal = (instruction: string) => instruction.toLowerCase().replace(/[’`]/g, '\'').replace(/[^a-z0-9#'.,;!?\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
function readable(instruction: string) {
  const text = normal(instruction), changes = text.replace(NEGATION, ' ');
  // State words in a preservation clause still state the wanted result ("keep the door open"); other words do not.
  return { text, states: changes, others: changes.replace(PRESERVE, ' ') };
}
/** The state changes an instruction names (open, close, …), ignoring negated clauses. */
export function stateChanges(instruction: string) {
  const { states } = readable(instruction);
  return STATES.filter(s => s.pattern.test(states)).map(s => s.name);
}

export function classifyLayerEdit(instruction: string, options: { region?: boolean } = {}): LayerEditIntent {
  const { text, others } = readable(instruction), operations = new Set<LayerEditOperation>(), states = stateChanges(instruction);
  if (REPLACE.test(others)) operations.add('replace');
  const clean = CLEAN.test(others);
  if (clean) operations.add('clean');
  if (states.length) operations.add('state');
  const cue = CHANGE_CUE.test(others);
  // A requested replacement's colour and material describe the new object, not a change to this one.
  if (!operations.has('replace') && (COLOUR_CHANGE.test(others) || (cue && COLOUR_WORD.test(others)))) operations.add('color');
  if (!operations.has('replace') && cue && MATERIAL_WORD.test(others.replace(/\bglass\s+(?:door|doors|shelf|shelves|panel|panels)\b/g, ' '))) operations.add('material');
  if (REMOVE.test(others) && !clean) operations.add('remove');
  if (ADD.test(others) && !operations.has('replace')) operations.add('add');
  if (!operations.size) operations.add('general');
  const intent: LayerEditIntent = {
    operations: [...operations],
    preserveIdentity: !operations.has('replace'),
    // Room around the object for parts that swing, fold out or are added, and for a requested replacement.
    expandsSilhouette: operations.has('state') || operations.has('add') || operations.has('replace'),
  };
  const clarification = clarify(text, states, !!options.region);
  return clarification ? { ...intent, clarification } : intent;
}

function clarify(text: string, states: string[], region: boolean) {
  const bare = text.replace(/[.,;!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!bare || VAGUE.test(bare)) return 'This instruction does not say what should change. Describe the specific change, for example “open both doors” or “make the handles chrome”.';
  const contradiction = STATES.find(s => s.opposite && states.includes(s.name) && states.includes(s.opposite));
  // Two opposite changes are only clear when they name different parts.
  if (contradiction && new Set(bare.match(DISTINCT_PARTS) ?? []).size < 2) {
    const [a, b] = [contradiction.name, contradiction.opposite].map(s => s.replace('-', ' '));
    return `This instruction asks to both ${a} and ${b}, so the final state is unclear. Describe the one state the edited image should show, for example “${a} both doors” or “${b} all doors”.`;
  }
  if (region && states.length) return 'An area limit keeps everything outside it unchanged, so moving parts cannot swing or extend beyond it. Remove the area limit, or describe a change that stays inside it.';
  return undefined;
}

/**
 * The earlier recorded instruction this one undoes (close after open), when the new instruction is only that reversal. Its
 * result should then match the image before that earlier edit, which the identity gate checks strictly.
 */
export function reversedInstruction(instruction: string, history: readonly (string | undefined)[]): number | undefined {
  const intent = classifyLayerEdit(instruction), states = stateChanges(instruction);
  if (intent.clarification || intent.operations.some(o => o !== 'state') || !states.length) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const earlierText = history[i];
    if (earlierText === undefined) return undefined; // An unrecorded earlier edit: what it did is unknown.
    const earlier = stateChanges(earlierText);
    if (classifyLayerEdit(earlierText).operations.some(o => o !== 'state')) return undefined;
    if (states.every(s => STATES.some(x => x.name === s && x.opposite && earlier.includes(x.opposite)))) return i;
    if (earlier.length) return undefined; // Only the most recent state change can be reversed this way.
  }
  return undefined;
}
