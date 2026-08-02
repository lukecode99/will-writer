import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { WillData, MaritalStatus } from '../types';
import { dobError, parseUkDate, ageInYears, formatUkDateInput } from '../family';
import { unprintableChars } from '../text';
import { C, shared } from './shared';

interface Props {
  data: WillData;
  onChange: (u: Partial<WillData>) => void;
  onNext: () => void;
}

const STATUS_OPTIONS: { value: MaritalStatus; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'civilPartnership', label: 'Civil Partnership' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
];

export default function AboutYou({ data, onChange, onNext }: Props) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Filling a will in for someone else is a supported thing to do, but every
  // "you" on this screen then means a different person from the one holding the
  // phone, and a form that gets that wrong collects the wrong details.
  const other = data.isForSomeoneElse;

  function validate() {
    const e: Record<string, string> = {};

    if (!data.fullName.trim()) {
      e.fullName = 'Full name is required';
    } else {
      // A name we cannot print is caught here rather than at the end, so it is
      // reported next to the field that caused it while it is still on screen.
      const bad = unprintableChars(data.fullName);
      if (bad.length > 0) {
        e.fullName = `We cannot print ${bad.join(' ')}. Please write the name using the Latin alphabet — it has to match the name a court in England and Wales will read.`;
      }
    }

    if (!data.address.trim()) {
      e.address = 'Address is required';
    } else {
      const bad = unprintableChars(data.address);
      if (bad.length > 0) e.address = `We cannot print ${bad.join(' ')} in the address.`;
    }

    // The old check was `!dob.trim()`, so "99/99/9999" passed and was echoed
    // back on the review screen as if it had been confirmed.
    const dobProblem = dobError(data.dob);
    if (dobProblem) {
      e.dob = dobProblem;
    } else {
      const dob = parseUkDate(data.dob);
      // Wills Act 1837 s.7 — a will made under 18 is not valid.
      if (dob && ageInYears(dob) < 18) {
        e.dob = other
          ? 'A person must be 18 or over to make a will in England and Wales.'
          : 'You must be 18 or over to make a will in England and Wales.';
      }
    }

    if (!data.maritalStatus) e.maritalStatus = 'Please select a marital status';

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // Errors are computed on Continue, but they used to also persist until the
  // next Continue — the message sat there calling the corrected value wrong.
  // Editing a field clears its own error at once; the full check still runs
  // before moving on.
  function edit(field: string, updates: Partial<WillData>) {
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    onChange(updates);
  }

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>{other ? 'About the person making this will' : 'About You'}</Text>
      <Text style={shared.sub}>
        {other
          ? 'These are their details, not yours. The will is written in their voice, and they are the one who signs it.'
          : 'We need a few personal details to create your Will.'}
      </Text>

      {other ? (
        // Saying this once, up front, is the whole reason the app asks who the
        // will is for. A will written out by someone who stands to gain under
        // it is the classic shape of a challenge — the executors then have to
        // prove the testator knew and approved of what they signed. Better the
        // person typing hears it now than the family hears it in court.
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Before you fill this in for someone else</Text>
          <Text style={styles.noticeText}>
            They must read the finished will, understand it, and sign it themselves in front of
            two witnesses. Nobody can sign it for them.{'\n\n'}
            They must be able to understand what they own and who has a claim on them. If they
            are seriously ill or confused, get a solicitor — capacity is the thing most often
            argued about afterwards.{'\n\n'}
            If you or your family stand to inherit under this will, be careful. That is exactly
            the situation courts look at hardest, and a solicitor's involvement is what usually
            settles it.
          </Text>
        </View>
      ) : null}

      <Text style={shared.label}>Full legal name *</Text>
      <TextInput
        style={[shared.input, errors.fullName ? shared.inputError : null]}
        placeholder="e.g. John Robert Smith"
        value={data.fullName}
        onChangeText={v => edit('fullName', { fullName: v })}
        autoCapitalize="words"
      />
      {errors.fullName ? <Text style={shared.error}>{errors.fullName}</Text> : null}

      <Text style={shared.label}>Current address *</Text>
      <TextInput
        style={[shared.input, shared.inputMulti, errors.address ? shared.inputError : null]}
        placeholder="Full address including postcode"
        value={data.address}
        onChangeText={v => edit('address', { address: v })}
        multiline
        numberOfLines={3}
      />
      {errors.address ? <Text style={shared.error}>{errors.address}</Text> : null}

      <Text style={shared.label}>Date of birth * (DD/MM/YYYY)</Text>
      <TextInput
        style={[shared.input, errors.dob ? shared.inputError : null]}
        placeholder="DD/MM/YYYY"
        value={data.dob}
        onChangeText={v => edit('dob', { dob: formatUkDateInput(v) })}
        keyboardType="number-pad"
      />
      {errors.dob ? <Text style={shared.error}>{errors.dob}</Text> : null}

      <Text style={shared.label}>Marital status *</Text>
      <View style={styles.chipRow}>
        {STATUS_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.chip, data.maritalStatus === opt.value ? styles.chipActive : null]}
            onPress={() =>
              opt.value === 'married' || opt.value === 'civilPartnership'
                ? edit('maritalStatus', { maritalStatus: opt.value, expectingMarriage: false, intendedSpouseName: '' })
                : edit('maritalStatus', { maritalStatus: opt.value })
            }
          >
            <Text style={[styles.chipText, data.maritalStatus === opt.value ? styles.chipTextActive : null]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {errors.maritalStatus ? <Text style={shared.error}>{errors.maritalStatus}</Text> : null}

      <TouchableOpacity style={shared.primaryBtn} onPress={() => validate() && onNext()}>
        <Text style={shared.primaryBtnText}>Continue</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7C2D12',
    marginBottom: 6,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#7C2D12',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  chipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  chipText: {
    fontSize: 14,
    color: C.text,
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
});
