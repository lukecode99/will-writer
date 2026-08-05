import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, StyleSheet } from 'react-native';
import { WillData, Beneficiary, NamedSubstituteFallback, Substitute, SubstitutionType } from '../types';
import { blockingProblems, minorFlagWarning, parsePercentage, percentageTotal } from '../validation';
import { KnownPerson, knownPeople, knownRefs } from '../people';
import { C, shared } from './shared';
import { notify, confirmDestructive } from '../platform';
import { ScopeNotice } from '../components/ScopeNotice';

interface Props {
  data: WillData;
  onChange: (u: Partial<WillData>) => void;
  onNext: () => void;
  onBack: () => void;
}

function uid() {
  return Math.random().toString(36).slice(2);
}


/**
 * Percentages are digits only, 1–100, at most two decimal places.
 *
 * Free text used to get through: "half" parsed to 0 via `parseFloat || 0`, so a
 * 100 + "half" pair summed to exactly 100, passed the total check, and printed
 * "half%" into the signed document. Constrain at the keystroke instead.
 */
function sanitisePct(raw: string): string {
  let s = raw.replace(/[^0-9.]/g, '');

  // Keep only the first decimal point.
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }

  const [intRaw, decRaw] = s.split('.');
  // Strip leading zeros ("007" -> "7") but keep a lone "0" so "0.5" is typable.
  let intPart = intRaw.replace(/^0+(?=\d)/, '').slice(0, 3);
  s = decRaw === undefined ? intPart : `${intPart}.${decRaw.slice(0, 2)}`;

  const n = parseFloat(s);
  if (!isNaN(n) && n > 100) return '100';
  return s;
}

/**
 * Returns an error string for a share that can't go in a will, or '' if it's fine.
 * Uses the same strict parser as the document generator, so what this screen
 * accepts and what the PDF will accept cannot drift apart.
 */
function pctError(raw: string): string {
  if (raw.trim() === '') return 'Enter a share between 1 and 100.';
  return parsePercentage(raw) === null ? 'Enter a number between 1 and 100.' : '';
}

function proRataResult(
  beneficiaries: Beneficiary[],
  deceasedId: string,
): Array<{ name: string; pct: number }> {
  const survivors = beneficiaries.filter(b => b.id !== deceasedId && (parsePercentage(b.percentage) ?? 0) > 0);
  const totalSurvivor = survivors.reduce((s, b) => s + (parsePercentage(b.percentage) ?? 0), 0);
  if (totalSurvivor === 0 || survivors.length === 0) return [];
  return survivors.map(b => ({
    name: b.name || '(unnamed)',
    pct: ((parsePercentage(b.percentage) ?? 0) / totalSurvivor) * 100,
  }));
}

function previewText(b: Beneficiary, data: WillData): string {
  const allBens = data.beneficiaries;
  const name = b.name || (b.isCharity ? 'this charity' : 'this person');
  // Reads as "their 40% share" once a figure is entered, "their share" until then.
  const pct = b.percentage.trim() ? `${b.percentage.trim()}% ` : '';
  // A charity does not die — the event its substitution waits for is it having
  // ceased to exist, and the preview has to describe the event the will uses.
  const gone = b.isCharity
    ? `If ${name} no longer exists when you die`
    : `If ${name} dies before you`;
  const sub = b.substitution;
  switch (sub.type) {
    case 'unchosen':
      // No guess is offered. The screen shows nothing selected and this line
      // says why, so the gap reads as a question still to answer rather than a
      // choice already made. Validation blocks Continue until one is picked.
      return `Not yet chosen. Pick what happens to ${name}'s ${pct}share if ${name} dies before you.`;
    case 'own-children':
      // Says "including any child born after you sign" out loud. It is the one
      // property of a class gift nobody expects a form to have, and the reason
      // this option is safe to leave alone once chosen.
      return data.children.length === 0
        ? `If ${name} dies before you, their ${pct}share would pass to your children — but none are listed on Partner & Children yet.`
        : `If ${name} dies before you, their ${pct}share passes equally to your own children (including any child born after you sign this will). If one of your children has already died, their share goes to their own children.`;
    case 'per-stirpes':
      // Spelled out as "their children, who may not be yours". Left implicit,
      // "their own children" reads as "our children" to anyone thinking about
      // the family they have now, and in a blended family that is the whole
      // estate going to the wrong side of it.
      return `If ${name} dies before you, their ${pct}share passes equally to ${name}'s own children — who may not be the same people as your children (per stirpes). If they have no children, the share is divided among the other surviving beneficiaries.`;
    case 'named': {
      const subs = sub.substitutes;
      if (subs.length === 0) return `${gone}, their ${pct}share passes to people you name — none added yet.`;
      if (subs.length === 1) {
        const who = subs[0].name.trim() || '(name not yet entered)';
        return sub.namedFallback === 'issue'
          ? `${gone}, their ${pct}share passes to ${who}. If they die before you too, it passes equally to ${who}'s own children; only if they leave no children is it divided among the other surviving beneficiaries.`
          : `${gone}, their ${pct}share passes to ${who}. If they die before you too, it is divided among the other surviving beneficiaries.`;
      }
      // Read back as a share of the estate as well as of the share, because
      // that conversion is where the misunderstanding lives — "50%" typed under
      // a beneficiary on 60% is 30% of the estate, and nobody does that
      // arithmetic in their head while filling in a form.
      const ofEstate = parsePercentage(b.percentage);
      const parts = subs.map(s => {
        const who = s.name.trim() || '(name not yet entered)';
        const share = parsePercentage(s.share);
        if (share === null) return `${who} (share not set)`;
        const estatePart = ofEstate === null ? '' : ` = ${Number(((share / 100) * ofEstate).toFixed(2))}% of your estate`;
        return `${who} ${share}%${estatePart}`;
      });
      return sub.namedFallback === 'issue'
        ? `${gone}, their ${pct}share is divided between: ${parts.join('; ')}. If one of them dies before you too, their part passes equally to their own children; only if they leave no children does it go to the others named, and failing that to the other surviving beneficiaries.`
        : `${gone}, their ${pct}share is divided between: ${parts.join('; ')}. If one of them dies before you too, their part goes to the others; if none survive, it is divided among the other surviving beneficiaries.`;
    }
    case 'pro-rata': {
      const others = proRataResult(allBens, b.id);
      if (others.length === 0) {
        return `${gone}, their ${pct}share would go to surviving co-beneficiaries — but there are none yet.`;
      }
      const parts = others.map(o => `${o.name} (${o.pct.toFixed(1)}%)`).join(', ');
      return `${gone}, their ${pct}share is divided pro-rata among the other beneficiaries: ${parts}.`;
    }
  }
}

interface SubOption { value: SubstitutionType; label: string; detail: string }

const OWN_CHILDREN_OPTION: SubOption = {
  value: 'own-children',
  label: 'My children equally',
  detail: 'Passes to your own children in equal shares, and to a deceased child\'s children in their place. This is the usual choice for a partner.',
};

const BASE_OPTIONS: SubOption[] = [
  {
    value: 'per-stirpes',
    label: 'Their children equally',
    detail: 'Passes to their own children in equal shares (per stirpes). If one of those children has also died, that child\'s own children take their parent\'s part between them; a child who dies leaving no children drops out and the others share equally. Default under Wills Act 1837 s.33 for your own children.',
  },
  {
    value: 'named',
    label: 'People or charities I name',
    detail: 'Their share goes to one or more people you choose, in shares you set. They do not have to be related to this beneficiary.',
  },
  {
    value: 'pro-rata',
    label: 'Pro-rata among survivors',
    detail: 'Their share is divided among the other beneficiaries in proportion to their existing shares.',
  },
];

/**
 * Where a named substitute's own part goes if the substitute also dies first.
 *
 * Until this existed the answer was hardcoded to the survivors route, which is
 * the right default but not always the wish — "to my friend, and if she goes
 * first, to her kids" needs the second option. Both are stated in terms of the
 * onward destination rather than legal labels, because "per stirpes" on a
 * button answers nothing for the person reading it.
 */
const FALLBACK_OPTIONS: { value: NamedSubstituteFallback; label: string; detail: string }[] = [
  {
    value: 'survivors',
    label: 'The others share it',
    detail: 'Their part is shared by the other people named here — or, if none of them survive, by your other beneficiaries.',
  },
  {
    value: 'issue',
    label: 'Their own children take it',
    detail: 'Their part passes equally to their own children (per stirpes). Only if they leave no children does it go to the others.',
  },
];

/**
 * The substitutes that make sense for this particular beneficiary.
 *
 * "My children equally" is offered first where it applies, because for a partner
 * it is the answer nearly everyone wants and the one the app used to make people
 * approximate with "their children equally". It is withheld in two cases:
 *
 * - No children listed, since it would give the share to an empty class.
 * - The beneficiary is one of your own children, where it contradicts itself —
 *   see the note on `SubstitutionType`. "Their children equally" already means
 *   your grandchildren there.
 *
 * An option that is withheld but already chosen on a saved draft is added back,
 * so the screen shows the will as it actually stands rather than silently
 * appearing to have selected nothing. Validation is what objects to it.
 */
function subOptions(b: Beneficiary, data: WillData): SubOption[] {
  // A charity has no children and no issue: the family-based substitutions are
  // meaningless for it, and validation refuses to draft them. Withheld here,
  // except where a saved draft already chose one — that is shown so the screen
  // reflects the will as it actually stands, and validation is what objects.
  if (b.isCharity) {
    const opts = BASE_OPTIONS.filter(o => o.value === 'named' || o.value === 'pro-rata');
    if (b.substitution.type === 'per-stirpes') opts.unshift(BASE_OPTIONS[0]);
    if (b.substitution.type === 'own-children') opts.unshift(OWN_CHILDREN_OPTION);
    return opts;
  }
  const eligible = data.children.length > 0 && !b.isOwnChild;
  if (eligible || b.substitution.type === 'own-children') {
    return [OWN_CHILDREN_OPTION, ...BASE_OPTIONS];
  }
  return BASE_OPTIONS;
}

export default function ResiduaryEstate({ data, onChange, onNext, onBack }: Props) {
  // Whether the "who is this beneficiary?" chooser is open. The people already
  // entered used to sit permanently above the add button as a wall of chips —
  // read as "these people are already in the will" by exactly the person the
  // chips were meant to help. Now the question is only asked once someone has
  // said they are adding a beneficiary, which is the only moment it makes sense.
  const [choosing, setChoosing] = useState(false);
  const known = knownPeople(data);
  const byRef = new Map(known.map(p => [p.ref, p]));
  const liveRefs = knownRefs(data);

  // Once chosen, a person leaves the list. Enforcing it by construction rather
  // than by validation is the difference between "you cannot do this" and "you
  // did this and here is a message about it" — and two entries for one person
  // is never what anyone meant.
  const available = known.filter(p => !data.beneficiaries.some(b => b.linkedPersonId === p.ref));

  /** `person` omitted means "someone else": a name typed by hand, unlinked. */
  function addBeneficiary(person?: KnownPerson) {
    onChange({
      beneficiaries: [
        ...data.beneficiaries,
        {
          id: uid(),
          linkedPersonId: person ? person.ref : '',
          name: person ? person.name : '',
          relationship: person ? person.relationship : '',
          percentage: '',
          isOwnChild: person ? person.isOwnChild : false,
          isMinor: false,
          isCharity: false,
          // Starts unselected on purpose: the app no longer guesses what happens
          // if this beneficiary dies first. Nothing is pre-selected below, and
          // validation blocks Continue until the user chooses (see types.ts).
          substitution: {
            type: 'unchosen',
            substitutes: [],
            namedFallback: 'survivors',
          },
        },
      ],
    });
  }

  function updateBen(id: string, updates: Partial<Beneficiary>) {
    onChange({
      beneficiaries: data.beneficiaries.map(b => b.id === id ? { ...b, ...updates } : b),
    });
  }

  function removeBen(id: string) {
    const b = data.beneficiaries.find(x => x.id === id);
    const doRemove = () => onChange({ beneficiaries: data.beneficiaries.filter(x => x.id !== id) });
    // A blank row is scaffolding, not a decision — no ceremony to remove it.
    if (!b || (!b.name.trim() && !b.percentage.trim())) {
      doRemove();
      return;
    }
    confirmDestructive(
      `Remove ${b.name.trim() || 'this beneficiary'} from the residuary estate? Their share goes back into the unallocated total.`,
      'Remove',
      doRemove,
    );
  }

  function setSubstitutes(b: Beneficiary, substitutes: Substitute[]) {
    updateBen(b.id, { substitution: { ...b.substitution, substitutes } });
  }

  /**
   * Shares reset to an equal split whenever a substitute is added or removed.
   *
   * The alternative — leave the existing figures alone and let the new row
   * default to whatever is left — puts the user in an invalid state by their own
   * action every single time, because "whatever is left" of a complete split is
   * nothing. They would add a second substitute and be told immediately that
   * their will does not add up.
   *
   * An equal split is both always valid and what nearly everyone means by "and
   * then to the children". Anyone who wants 70/30 types over it, and the reset
   * only fires on add and remove, so a hand-set split survives everything except
   * changing the number of people it was a split between — at which point it had
   * to be revisited anyway.
   *
   * The remainder lands on the last entry rather than being spread, so three
   * people come to exactly 100 (33.33 / 33.33 / 33.34) instead of 99.99. The
   * tolerance would have accepted 99.99; the document would have said it.
   */
  function evenShares(substitutes: Substitute[]): Substitute[] {
    if (substitutes.length <= 1) {
      return substitutes.map(s => ({ ...s, share: '100' }));
    }
    const each = Math.floor((100 / substitutes.length) * 100) / 100;
    const last = Number((100 - each * (substitutes.length - 1)).toFixed(2));
    return substitutes.map((s, i) => ({
      ...s,
      share: String(i === substitutes.length - 1 ? last : each),
    }));
  }

  function addSub(b: Beneficiary, name: string) {
    setSubstitutes(b, evenShares([...b.substitution.substitutes, { id: uid(), name, share: '', address: '' }]));
  }

  function updateSub(b: Beneficiary, subId: string, updates: Partial<Substitute>) {
    setSubstitutes(b, b.substitution.substitutes.map(s => s.id === subId ? { ...s, ...updates } : s));
  }

  function removeSub(b: Beneficiary, subId: string) {
    const s = b.substitution.substitutes.find(x => x.id === subId);
    const doRemove = () =>
      setSubstitutes(b, evenShares(b.substitution.substitutes.filter(x => x.id !== subId)));
    if (!s || !s.name.trim()) {
      doRemove();
      return;
    }
    confirmDestructive(
      `Remove ${s.name.trim()} as a substitute? The remaining substitutes reset to an equal split.`,
      'Remove',
      doRemove,
    );
  }

  const total = percentageTotal(data);
  const totalOk = data.beneficiaries.length > 0 && Math.abs(total - 100) < 0.01;

  /**
   * The rules live in `validation.ts`, not here. This screen used to be the only
   * place the 100% check existed, so every other route to Review skipped it. Now
   * it asks the shared checker for whatever it says about this step, which means
   * this button and the Review screen can never disagree.
   */
  function handleNext() {
    const problems = blockingProblems(data).filter(p => p.step === 'residuary');
    if (problems.length > 0) {
      notify(problems.map(p => `• ${p.message}`).join('\n'), 'Not finished yet');
      return;
    }
    onNext();
  }

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Residuary Estate</Text>
      <Text style={shared.sub}>
        Your residuary estate is everything left after debts, expenses, and any specific gifts.
        Split it between beneficiaries — percentages must total 100%.
      </Text>

      {data.beneficiaries.map((b, i) => {
        const linked = b.linkedPersonId ? byRef.get(b.linkedPersonId) : undefined;
        // Set but unresolvable: the person was removed from the family details
        // after this share was set up. Distinguished from a name merely left
        // blank mid-edit, which is not a removal and must not be reported as one.
        const dangling = !!b.linkedPersonId && !liveRefs.has(b.linkedPersonId);
        return (
        <View key={b.id} style={shared.card}>
          <View style={shared.cardHeader}>
            <Text style={shared.cardTitle}>Beneficiary {i + 1}</Text>
            <TouchableOpacity style={shared.dangerBtn} onPress={() => removeBen(b.id)}>
              <Text style={shared.dangerBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>

          <Text style={shared.label}>Full name</Text>
          {linked ? (
            /* Not editable here on purpose. This entry is a reference to a
               person, not a copy of their name, so a second place to edit the
               name would be a second version of it — and the version that
               reached the will would depend on which screen was touched last. */
            <>
              <View style={styles.linkedName}>
                <Text style={styles.linkedNameText}>{linked.name}</Text>
                <Text style={styles.linkedTag}>from your family details</Text>
              </View>
              <Text style={shared.hint}>
                To change the spelling, edit it on the Family step — it is the same person, so it has
                to read the same way in both places.
              </Text>
            </>
          ) : (
            <>
              <TextInput
                style={[shared.input, !b.name.trim() ? styles.inputError : null]}
                placeholder="Full legal name"
                value={b.name}
                onChangeText={v => updateBen(b.id, { name: v })}
                autoCapitalize="words"
              />
              {!b.name.trim() ? (
                <Text style={styles.errorText}>
                  A share left to nobody in particular cannot be paid out. Name this beneficiary, or remove them.
                </Text>
              ) : null}
            </>
          )}
          {dangling ? (
            <Text style={styles.errorText}>
              This person is no longer in your family details. Their share has been left exactly as it
              was — check the name is right, or remove them.
            </Text>
          ) : null}

          <Text style={shared.label}>Relationship</Text>
          {linked ? (
            /* Locked for the same reason the name is. For a person picked from
               the family details the relationship is a fact the app already
               holds — partner or child — and it follows the marital status
               automatically, so "partner" becomes "spouse" when the About You
               answer changes. A second editable copy here was a way to tell
               the will this person is someone they are not. */
            <View style={styles.linkedName}>
              <Text style={styles.linkedNameText}>{b.relationship}</Text>
              <Text style={styles.linkedTag}>from your family details</Text>
            </View>
          ) : (
            <TextInput
              style={shared.input}
              placeholder="e.g. spouse, daughter, friend"
              value={b.relationship}
              onChangeText={v => updateBen(b.id, { relationship: v })}
            />
          )}
          {linked ? null : <ScopeNotice text={b.relationship} />}

          <Text style={shared.label}>Share (%)</Text>
          <TextInput
            style={[shared.input, pctError(b.percentage) && b.percentage.trim() !== '' ? styles.inputError : null]}
            placeholder="e.g. 50"
            value={b.percentage}
            onChangeText={v => updateBen(b.id, { percentage: sanitisePct(v) })}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={6}
          />
          {b.percentage.trim() !== '' && pctError(b.percentage) !== '' && (
            <Text style={styles.errorText}>{pctError(b.percentage)}</Text>
          )}

          {/* Everything the will says about this beneficiary is worded for
              either a person or an organisation, so this switch is asked
              first. Turning it on clears the two person-only facts by
              construction — a charity is nobody's child and has no age — and
              moves a family-based substitution to pro-rata, visibly, in the
              radio group below. Someone picked from the family details is a
              person by definition, so the switch is locked for them. */}
          {!linked ? (
            <View style={styles.toggleRow}>
              <Switch
                value={b.isCharity}
                onValueChange={v => updateBen(b.id, v
                  ? {
                      isCharity: true,
                      isOwnChild: false,
                      isMinor: false,
                      ...(b.substitution.type === 'per-stirpes' || b.substitution.type === 'own-children'
                        ? { substitution: { ...b.substitution, type: 'pro-rata' as SubstitutionType } }
                        : {}),
                    }
                  : { isCharity: false })}
                thumbColor={b.isCharity ? C.primary : '#ccc'}
                trackColor={{ false: '#ddd', true: '#9BAFD1' }}
              />
              <Text style={styles.toggleLabel}>This is a charity or organisation</Text>
            </View>
          ) : null}

          {b.isCharity ? (
            <Text style={shared.hint}>
              Use the charity's full registered name, and check it against the Charity Commission
              register — a misnamed charity is a gift the executors have to go to court to interpret.
            </Text>
          ) : (
            <>
              {/* Locked when the beneficiary was picked from the family details,
                  because there it is a fact rather than an opinion. It drives the
                  s.33 warning below, and letting someone untick it for their own
                  child would switch that warning off for the one person it is
                  about. */}
              <View style={styles.toggleRow}>
                <Switch
                  value={b.isOwnChild}
                  onValueChange={v => updateBen(b.id, { isOwnChild: v })}
                  disabled={!!linked}
                  thumbColor={b.isOwnChild ? C.primary : '#ccc'}
                  trackColor={{ false: '#ddd', true: '#9BAFD1' }}
                />
                <Text style={styles.toggleLabel}>
                  This is my child{linked ? ' — from your family details' : ''}
                </Text>
              </View>

              <View style={styles.toggleRow}>
                <Switch
                  value={b.isMinor}
                  onValueChange={v => updateBen(b.id, { isMinor: v })}
                  thumbColor={b.isMinor ? C.primary : '#ccc'}
                  trackColor={{ false: '#ddd', true: '#9BAFD1' }}
                />
                <Text style={styles.toggleLabel}>This beneficiary is under 18</Text>
              </View>

              {/* The switch above quietly rewrites the gift as a trust, so its
                  consequence is stated here, next to the hand that flipped it,
                  not only in the document. */}
              {b.isMinor ? (
                <Text style={shared.hint}>
                  Because they are under 18, their share will be held on trust by your executors until
                  their 18th birthday — it cannot be paid to them directly before then.
                </Text>
              ) : null}
            </>
          )}

          {/* Said beside the switch as well as on Review. The switch is a quiet
              one — it rewrites the gift as a trust — and this is the only place
              the person who flipped it is still looking. */}
          {!!minorFlagWarning(data, b) && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>⚠️ {minorFlagWarning(data, b)}</Text>
            </View>
          )}

          {/* Said here as well as on the review screen, because this is the
              switch that causes it and the family list is two steps back. The
              guardian sentence is the part that matters: a share can be argued
              about afterwards, but who looks after a young child cannot be,
              because by then the person who knew the answer is dead. */}
          {b.isOwnChild && data.children.length === 0 && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                ⚠️ You have marked {b.name.trim() || 'this beneficiary'} as your child, but no children are
                listed on the Partner &amp; Children step. Add them there — that list is what the rest of
                the will works from.
                {b.isMinor
                  ? ' Because they are not on it, you will not be asked to appoint a guardian for them, even though you have said they are under 18.'
                  : ''}
              </Text>
            </View>
          )}

          <Text style={[shared.label, { marginTop: 16 }]}>
            {b.isCharity
              ? `If ${b.name || 'this charity'} no longer exists when you die`
              : `If ${b.name || 'this person'} dies before you`}
          </Text>
          <Text style={[shared.hint, b.substitution.type === 'unchosen' && styles.hintRequired]}>
            {b.substitution.type === 'unchosen'
              ? 'Required — choose one. Your will cannot be finished until you say what happens to their share.'
              : 'Choose what happens to their share.'}
          </Text>

          <View style={styles.radioGroup}>
            {subOptions(b, data).map(opt => {
              const selected = b.substitution.type === opt.value;
              // "Pro-rata among survivors" has nothing to divide when this is the
              // only beneficiary — so it is shown greyed and non-selectable, with
              // the reason in place of the usual detail, rather than left as a
              // choice that quietly sends the share nowhere. Validation is the
              // backstop if a saved draft still carries it.
              const reason = opt.value === 'pro-rata' && proRataResult(data.beneficiaries, b.id).length === 0
                ? 'There are no other beneficiaries to share it — add another beneficiary, or choose one of the options above.'
                : null;
              const disabled = !!reason;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.radioOption, selected && styles.radioOptionSelected, disabled && styles.radioOptionDisabled]}
                  activeOpacity={disabled ? 1 : 0.2}
                  onPress={disabled ? undefined : () => updateBen(b.id, { substitution: { ...b.substitution, type: opt.value } })}
                >
                  <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
                    {selected && <View style={styles.radioInner} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.radioLabel, selected && styles.radioLabelSelected]}>{opt.label}</Text>
                    <Text style={styles.radioDetail}>{disabled ? reason : opt.detail}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {b.substitution.type === 'named' && (() => {
            const subs = b.substitution.substitutes;
            const multiple = subs.length > 1;
            const subTotal = subs.reduce((s, x) => s + (parsePercentage(x.share) ?? 0), 0);
            const subTotalOk = Math.abs(subTotal - 100) < 0.01;
            const benPct = parsePercentage(b.percentage);
            return (
              <>
                <Text style={shared.label}>
                  {multiple ? 'Who receives their share' : 'Name of substitute recipient'}
                </Text>
                <Text style={shared.hint}>
                  {multiple
                    ? `Shares here are shares of ${b.name.trim() || 'this beneficiary'}'s ${benPct === null ? '' : `${benPct}% `}share, and must total 100% of it.`
                    : 'Add more than one person if you want their share split.'}
                </Text>

                {subs.map(s => (
                  <View key={s.id} style={styles.subBlock}>
                    <View style={styles.subRow}>
                      <View style={{ flex: 1 }}>
                        <TextInput
                          style={[shared.input, !s.name.trim() ? styles.inputError : null]}
                          placeholder="Full name or charity name"
                          value={s.name}
                          onChangeText={v => updateSub(b, s.id, { name: v })}
                          autoCapitalize="words"
                        />
                      </View>
                      {multiple ? (
                        <View style={styles.subShare}>
                          <TextInput
                            style={[shared.input, pctError(s.share) ? styles.inputError : null]}
                            placeholder="%"
                            value={s.share}
                            onChangeText={v => updateSub(b, s.id, { share: sanitisePct(v) })}
                            keyboardType="decimal-pad"
                            inputMode="decimal"
                            maxLength={6}
                          />
                        </View>
                      ) : null}
                      <TouchableOpacity style={styles.subRemove} onPress={() => removeSub(b, s.id)}>
                        <Text style={shared.dangerBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    {/* Optional on purpose. A substitute may never inherit at
                        all, so the will is not blocked over their address —
                        but a bare name in a will is a search, not a person,
                        and executors are the ones who have to run it. */}
                    <TextInput
                      style={[shared.input, shared.inputMulti]}
                      placeholder="Their address (optional — helps your executors identify them)"
                      value={s.address}
                      onChangeText={v => updateSub(b, s.id, { address: v })}
                      multiline
                      numberOfLines={2}
                    />
                  </View>
                ))}

                {subs.some(s => !s.name.trim()) ? (
                  <Text style={styles.errorText}>
                    A share left to nobody in particular cannot be paid out. Name each substitute, or remove the row.
                  </Text>
                ) : null}
                {subs.length === 0 ? (
                  <Text style={styles.errorText}>
                    You have chosen named substitutes but not said who. Add someone, or pick a different option above.
                  </Text>
                ) : null}

                {/* Anyone already known to the will can be added with one tap.
                    Typed by hand is still allowed and always will be — the
                    whole point of this option is the people the app does not
                    know about: a stepchild, a partner's children, a friend. */}
                <View style={styles.chipRow}>
                  {known
                    .filter(p => !subs.some(s => s.name.trim().toLowerCase() === p.name.trim().toLowerCase()))
                    .map(p => (
                      <TouchableOpacity key={p.ref} style={styles.chip} onPress={() => addSub(b, p.name)}>
                        <Text style={styles.chipText}>+ {p.name}</Text>
                        <Text style={styles.chipRel}>{p.relationship}</Text>
                      </TouchableOpacity>
                    ))}
                  <TouchableOpacity style={styles.chip} onPress={() => addSub(b, '')}>
                    <Text style={styles.chipText}>+ Someone else</Text>
                  </TouchableOpacity>
                </View>

                {subs.length > 0 ? (
                  <>
                    <Text style={[shared.label, { marginTop: 14 }]}>
                      {multiple
                        ? 'If one of these people dies before you too'
                        : `If ${subs[0].name.trim() || 'this person'} dies before you too`}
                    </Text>
                    <View style={styles.radioGroup}>
                      {FALLBACK_OPTIONS.map(opt => {
                        const selected = b.substitution.namedFallback === opt.value;
                        return (
                          <TouchableOpacity
                            key={opt.value}
                            style={[styles.radioOption, selected && styles.radioOptionSelected]}
                            onPress={() => updateBen(b.id, { substitution: { ...b.substitution, namedFallback: opt.value } })}
                          >
                            <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
                              {selected && <View style={styles.radioInner} />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.radioLabel, selected && styles.radioLabelSelected]}>{opt.label}</Text>
                              <Text style={styles.radioDetail}>{opt.detail}</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                ) : null}

                {multiple ? (
                  <View style={[styles.totalBar, { backgroundColor: subTotalOk ? '#D1FAE5' : '#FEF3C7', marginTop: 8 }]}>
                    <Text style={[styles.totalText, { color: subTotalOk ? '#065F46' : '#92400E' }]}>
                      {subTotal.toFixed(1)}% of {b.name.trim() || 'their'} share
                      {subTotalOk ? ' ✓' : ` — need ${(100 - subTotal).toFixed(1)}% more`}
                    </Text>
                  </View>
                ) : null}
              </>
            );
          })()}

          {b.isOwnChild && b.substitution.type !== 'per-stirpes' && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                ⚠️ Warning: Section 33 of the Wills Act 1837 automatically passes a deceased child's share to
                their children. By choosing a different substitution you override this and disinherit{b.name ? ` ${b.name}'s` : ''} children.
                This may not be your intention — consider consulting a solicitor.
              </Text>
            </View>
          )}

          <View style={styles.previewBox}>
            <Text style={styles.previewText}>{previewText(b, data)}</Text>
          </View>
        </View>
        );
      })}

      {/* One button, then the question. Tapping "add" opens a chooser offering
          the people the will already knows about (picking one links the share
          to that person) alongside "someone else" for a hand-typed name. When
          nobody is left to offer, the button just adds a blank entry — a
          chooser with one option is a speed bump, not a question. */}
      {choosing && available.length > 0 ? (
        <View style={styles.pickerBlock}>
          <Text style={styles.pickerTitle}>Who is this beneficiary?</Text>
          <Text style={shared.hint}>
            Picking someone from your family details links this share to them, so correcting their
            name on the Family step corrects it here too. Each person can only be added once.
          </Text>
          <View style={styles.chipRow}>
            {available.map(p => (
              <TouchableOpacity
                key={p.ref}
                style={styles.chip}
                onPress={() => { addBeneficiary(p); setChoosing(false); }}
              >
                <Text style={styles.chipText}>+ {p.name}</Text>
                <Text style={styles.chipRel}>{p.relationship}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.chip}
              onPress={() => { addBeneficiary(); setChoosing(false); }}
            >
              <Text style={styles.chipText}>+ Someone else</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={shared.secondaryBtn} onPress={() => setChoosing(false)}>
            <Text style={shared.secondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={shared.addBtn}
          onPress={() => (available.length > 0 ? setChoosing(true) : addBeneficiary())}
        >
          <Text style={shared.addBtnText}>
            {data.beneficiaries.length > 0 ? '+ Add another beneficiary' : '+ Add a beneficiary'}
          </Text>
        </TouchableOpacity>
      )}

      {data.beneficiaries.length > 0 ? (
        <View style={[styles.totalBar, { backgroundColor: totalOk ? '#D1FAE5' : '#FEF3C7' }]}>
          <Text style={[styles.totalText, { color: totalOk ? '#065F46' : '#92400E' }]}>
            Total: {total.toFixed(1)}% {totalOk ? '✓' : `— need ${(100 - total).toFixed(1)}% more`}
          </Text>
        </View>
      ) : null}

      <Text style={[shared.sectionTitle, { marginTop: 28 }]}>If nobody survives</Text>
      <Text style={shared.sub}>
        If no beneficiary — and none of their substitutes — survives you by 30 days, who should receive the estate?
        Name a charity or a wider family member to prevent partial intestacy.
      </Text>
      <TextInput
        style={shared.input}
        placeholder="e.g. Cancer Research UK, or a cousin's full name"
        value={data.ultimateBackstop}
        onChangeText={v => onChange({ ultimateBackstop: v })}
        autoCapitalize="sentences"
      />
      {!data.ultimateBackstop && (
        <Text style={shared.hint}>
          If left blank, the estate would pass under the rules of intestacy — this may not match your wishes.
        </Text>
      )}
      <ScopeNotice text={data.ultimateBackstop} />

      <TouchableOpacity style={shared.primaryBtn} onPress={handleNext}>
        <Text style={shared.primaryBtnText}>Continue</Text>
      </TouchableOpacity>
      <TouchableOpacity style={shared.secondaryBtn} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  linkedName: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    paddingVertical: 10,
    gap: 8,
  },
  linkedNameText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  linkedTag: {
    fontSize: 11.5,
    color: C.textLight,
  },
  pickerBlock: {
    marginTop: 4,
    marginBottom: 12,
  },
  pickerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: C.primary,
    backgroundColor: '#EEF2FA',
  },
  chipText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: C.primary,
  },
  chipRel: {
    fontSize: 11,
    color: C.textLight,
    marginTop: 1,
  },
  inputError: {
    borderColor: C.danger,
  },
  hintRequired: {
    color: C.danger,
    fontWeight: '600',
  },
  subBlock: {
    marginBottom: 10,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subShare: {
    width: 78,
  },
  subRemove: {
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  errorText: {
    color: C.danger,
    fontSize: 12.5,
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  toggleLabel: {
    marginLeft: 10,
    fontSize: 14,
    color: C.text,
  },
  radioGroup: {
    marginTop: 6,
    gap: 8,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface,
    gap: 10,
  },
  radioOptionSelected: {
    borderColor: C.primary,
    backgroundColor: '#EEF2FA',
  },
  radioOptionDisabled: {
    opacity: 0.45,
    backgroundColor: '#F2F2F4',
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioCircleSelected: {
    borderColor: C.primary,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  radioLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  radioLabelSelected: {
    color: C.primary,
  },
  radioDetail: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
    lineHeight: 16,
  },
  warningBox: {
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  warningText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 17,
  },
  previewBox: {
    backgroundColor: '#F0F4FF',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  previewText: {
    fontSize: 12,
    color: '#1E3A8A',
    lineHeight: 17,
    fontStyle: 'italic',
  },
  totalBar: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
  },
  totalText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
