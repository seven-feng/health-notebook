import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { fillDocumentPatient } from '../db';
import { normalizedName } from '../domain/members';
import { useRecords } from '../state';
import { Button, Field, styles } from '../ui';

export function DocumentPatientFill({
  documentId,
  suggestedName = '',
  disabled = false,
  onFilled,
  onBusyChange,
}: {
  documentId: string;
  suggestedName?: string;
  disabled?: boolean;
  onFilled?: (patient: string, reportIds: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { reports, activeMember, refresh } = useRecords();
  const [open, setOpen] = useState(false);
  const [patient, setPatient] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const saving = useRef(false);
  const sections = reports.filter(
    (r) => r.documentId === documentId && r.memberId === activeMember.id,
  );
  const missing = sections.filter((r) => r.status === 'review' && !r.patient.trim());
  if (!missing.length && !message) return null;

  function begin() {
    const names = sections.map((r) => r.patient.trim()).filter(Boolean);
    const distinct = new Set(names.map(normalizedName));
    setPatient(
      suggestedName.trim() ||
        (distinct.size === 1 ? names[0]! : distinct.size === 0 ? activeMember.name : ''),
    );
    setMessage('');
    setOpen(true);
  }
  async function fill() {
    if (saving.current) return;
    const name = patient.trim();
    if (!name || name.length > 30) {
      setMessage('请填写 1–30 个字的原报告姓名。');
      return;
    }
    saving.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setMessage('');
    try {
      const ids = await fillDocumentPatient(documentId, activeMember.id, name);
      onFilled?.(name, ids);
      setOpen(false);
      setMessage(ids.length ? `已补全 ${ids.length} 类检查的姓名。` : '没有需要补全的空白姓名。');
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '填写未完成，请重试。');
    } finally {
      saving.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {open ? (
        <>
          <Field
            label="原报告姓名"
            testID="document-patient-input"
            value={patient}
            editable={!busy && !disabled}
            onChangeText={setPatient}
            placeholder="填写原报告上的姓名"
            autoCorrect={false}
          />
          <Text style={styles.small}>补全待核对检查的空白姓名，已有姓名保留。</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button
                title="取消"
                secondary
                disabled={busy}
                testID="cancel-document-patient"
                onPress={() => {
                  setOpen(false);
                  setMessage('');
                }}
              />
            </View>
            <View style={{ flex: 2 }}>
              <Button
                title={`填写 ${missing.length} 类检查`}
                busy={busy}
                disabled={disabled || !missing.length}
                testID="fill-document-patient"
                onPress={() => void fill()}
              />
            </View>
          </View>
        </>
      ) : missing.length > 0 ? (
        <Button
          title="统一填写姓名"
          secondary
          disabled={disabled}
          testID="open-document-patient"
          onPress={begin}
        />
      ) : null}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.small}>
          {message}
        </Text>
      )}
    </View>
  );
}
