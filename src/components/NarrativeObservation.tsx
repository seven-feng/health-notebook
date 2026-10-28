import { Pressable, Text, View } from 'react-native';
import type { DocumentRecord, Observation } from '../domain/types';
import { Button, color, Field, styles } from '../ui';
import { reviewCopy, reviewMessages } from '../domain/review-messages';
import { SourcePreview } from './SourcePreview';

export function NarrativeObservation({
  observation: o,
  index,
  document,
  expanded,
  editing,
  individualReview,
  reviewed,
  disabled,
  onToggle,
  onChange,
  onReview,
  onUndoReview,
  onEdit,
  onRemove,
  onLayout,
  openPage,
}: {
  observation: Observation;
  index: number;
  document?: DocumentRecord;
  expanded: boolean;
  editing: boolean;
  individualReview: boolean;
  reviewed: boolean;
  disabled: boolean;
  onToggle: () => void;
  onChange: (value: Partial<Observation>) => void;
  onReview: () => void;
  onUndoReview: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onLayout: (y: number) => void;
  openPage: () => void;
}) {
  return (
    <View
      testID={`observation-${index}`}
      onLayout={(e) => onLayout(e.nativeEvent.layout.y)}
      style={{ padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: color.line }}
    >
      <View style={styles.between}>
        <Text style={[styles.body, { flex: 1, fontWeight: '600' }]}>{o.name}</Text>
        {editing && (individualReview || reviewed) && (
          <Pressable
            testID={`review-checkbox-${index}`}
            accessibilityRole="checkbox"
            accessibilityLabel={`${o.name}已核对`}
            accessibilityState={{ checked: reviewed, disabled }}
            disabled={disabled || !o.name.trim() || !o.rawValue.trim()}
            onPress={reviewed ? onUndoReview : onReview}
            style={{ padding: 10 }}
          >
            <Text style={{ color: reviewed ? color.green : color.amber }}>
              {reviewed ? '已核对' : '待核对'}
            </Text>
          </Pressable>
        )}
      </View>
      {editing && expanded ? (
        <>
          <Field
            label="段落标题"
            value={o.name}
            editable={!disabled}
            onChangeText={(name) => onChange({ name })}
          />
          <Field
            label="原文内容"
            testID={`value-${index}`}
            value={o.rawValue}
            multiline
            editable={!disabled}
            style={{ minHeight: 120, textAlignVertical: 'top' }}
            onChangeText={(rawValue) => onChange({ rawValue })}
          />
        </>
      ) : (
        <Text
          testID={`observation-value-${index}`}
          selectable
          style={[styles.body, { lineHeight: 25 }]}
        >
          {o.rawValue || '未填写'}
        </Text>
      )}
      {editing &&
        reviewMessages(o.warnings ?? [])
          .filter((w) => w !== reviewCopy.item)
          .map((w) => (
            <Text key={w} style={styles.small}>
              {w}
            </Text>
          ))}
      {expanded && document && o.sourceRect && (
        <SourcePreview
          document={document}
          page={o.page}
          rect={o.sourceRect}
          name={o.name}
          index={index}
          openPage={openPage}
          initiallyExpanded
        />
      )}
      <Pressable
        testID={`observation-toggle-${index}`}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onToggle}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: color.green }}>
          {expanded ? '收起' : editing ? '修改文字／对照原件' : '对照原件'}
        </Text>
      </Pressable>
      {editing && expanded && individualReview && (
        <Button
          title="本段已核对"
          testID={`review-item-${index}`}
          disabled={disabled}
          onPress={onReview}
          secondary
        />
      )}
      {expanded && (
        <Button
          title={editing ? '移除此段' : '修改文字'}
          secondary
          disabled={disabled}
          testID={editing ? `remove-item-${index}` : `edit-item-${index}`}
          onPress={editing ? onRemove : onEdit}
        />
      )}
    </View>
  );
}
