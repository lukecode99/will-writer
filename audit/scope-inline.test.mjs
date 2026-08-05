/**
 * Unit test for the LIVE inline scope scanner (`scopeNotesForText`).
 *
 * The main audit harness proves the Review-screen path (`scopeWarnings` via
 * `warnings()`). This proves the other half: the per-field scan the entry
 * screens run on every keystroke to show a warning directly under the field.
 * They share one pattern set, so this mostly guards the inline plumbing — the
 * empty/clean short-circuit, one-note-per-category, and the false-positive
 * carve-outs ("business partner", "civil partnership", "equal shares").
 *
 * Run: node audit/scope-inline.test.mjs   (exits non-zero on any failure)
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('sucrase/register/ts');
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { scopeNotesForText } = require(join(ROOT, 'src/scope.ts'));

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}`);
  }
}
const keys = t => scopeNotesForText(t).map(n => n.key);
const has = (t, k) => keys(t).includes(k);

// Empty / whitespace / clean text raises nothing.
check('empty string is clean', scopeNotesForText('').length === 0);
check('whitespace is clean', scopeNotesForText('   ').length === 0);
check('ordinary gift is clean', scopeNotesForText('my vintage watch').length === 0);
check('equal shares is clean', scopeNotesForText('everything in equal shares').length === 0);
check('business partner (person) is clean', scopeNotesForText('my business partner Alan').length === 0);
check('civil partnership (relationship) is clean', scopeNotesForText('civil partnership').length === 0);

// Each category fires on its own vocabulary.
check('trust fires', has('hold on trust for my son', 'trust'));
check('trustee fires', has('my trustees shall decide', 'trust'));
check('business (Ltd) fires', has('my shares in Acme Ltd', 'business'));
check('business (my business) fires', has('leave my business to Sam', 'business'));
check('business partnership (asset) fires', has('my partnership interest', 'business'));
check('overseas fires', has('my villa abroad', 'overseas'));
check('agricultural fires', has('the farmland at Elm', 'agricultural'));
check('vulnerable fires', has('for my disabled brother', 'vulnerable'));
check('tax fires', has('inheritance tax planning', 'tax'));
check('conditional fires', has('only when he reaches 25', 'conditional'));

// One note per category however many hits; inline message names the trigger.
check('single note for repeated trigger', scopeNotesForText('trust trust trust').length === 1);
check('two categories -> two notes', scopeNotesForText('a trust for my disabled son').length === 2);
check('inline message quotes the trigger word', /"trust"/i.test(scopeNotesForText('a trust')[0].message));

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
