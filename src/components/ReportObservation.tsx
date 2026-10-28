import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DocumentRecord, Observation, Report } from '../domain/types';
import { sourceRegion } from '../domain/source-region';
import { Button, color, Field, styles } from '../ui';
import { SourcePreview } from './SourcePreview';
import { ObservationRange } from './ObservationRange';
import { referencePosition } from '../domain/reference-range';
import { reviewCopy } from '../domain/review-messages';
import { NarrativeObservation } from './NarrativeObservation';

export function ReportObservation({
  report,
  observation: o,
  document,
  index,
  expanded,
  editing,
  onToggle,
  onChange,
  onReview,
  onUndoReview,
  onRemove,
  onEdit,
  onLayout,
  openPage,
  reviewed = false,
  individualReview = false,
  disabled = false,
}: {
  report: Report;
  observation: Observation;
  document?: DocumentRecord;
  index: number;
  expanded: boolean;
  editing: boolean;
  onToggle: () => void;
  onChange: (values: Partial<Observation>) => void;
  onReview: () => void;
  onUndoReview: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onLayout: (y: number) => void;
  openPage: () => void;
  reviewed?: boolean;
  individualReview?: boolean;
  disabled?: boolean;
}) {
  const region = expanded && document ? sourceRegion(report, o) : undefined;
  const flag = o.reportFlag === 'high' ? '↑ 高于参考范围' : '↓ 低于参考范围';
  const displayName = o.unit === '%' ? o.name.replace(/\s*[（(]\s*%\s*[)）]\s*$/, '') : o.name;
  const range =
    !editing && report.status === 'confirmed' && !o.needsReview
      ? referencePosition(o.rawValue, o.reference)
      : null;
  const reviewDisabled = disabled || !o.name.trim() || !o.rawValue.trim();
  if (report.reportType === 'imaging')
    return (
      <NarrativeObservation
        observation={o}
        index={index}
        document={document}
        expanded={expanded}
        editing={editing}
        reviewed={reviewed}
        individualReview={individualReview}
        disabled={disabled}
        onToggle={onToggle}
        onChange={onChange}
        onReview={onReview}
        onUndoReview={onUndoReview}
        onEdit={onEdit}
        onRemove={onRemove}
        onLayout={onLayout}
        openPage={openPage}
      />
    );
  return (
    <View
      testID={`observation-${index}`}
      onLayout={({ nativeEvent }) => onLayout(nativeEvent.layout.y)}
      style={{
        backgroundColor: color.paper,
        borderRadius: 0,
        borderWidth: 0,
        borderBottomWidth: 1,
        borderColor: !editing && o.needsReview ? '#DFC9A4' : color.line,
        overflow: 'hidden',
      }}
    >
      {editing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable
            testID={`observation-toggle-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`第 ${index + 1} 项，${o.name || '未命名指标'}，${o.rawValue || '结果未填写'} ${o.unit}${individualReview ? '，待核对' : ''}${o.reportFlag ? `，原报告标记：${flag}` : ''}`}
            accessibilityHint={expanded ? '收起本项编辑' : '修改本项的数值、单位和参考范围'}
            accessibilityState={{ expanded, disabled }}
            disabled={disabled}
            onPress={onToggle}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 76,
              paddingVertical: 14,
              paddingRight: 6,
              backgroundColor: pressed ? color.bg : color.paper,
            })}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.body, { fontWeight: '500' }]}>
                {displayName || '未命名指标'}
              </Text>
              <Text style={[styles.small, { fontSize: 11 }]}>参考 {o.reference || '未记录'}</Text>
            </View>
            <View style={{ maxWidth: '43%', alignItems: 'flex-end', flexShrink: 1, gap: 2 }}>
              <Text
                testID={`observation-value-${index}`}
                style={{
                  fontSize: o.rawValue.length > 8 ? 15 : 21,
                  fontWeight: '500',
                  color: color.ink,
                  textAlign: 'right',
                }}
              >
                {o.rawValue || '未填写'}
                {o.reportFlag ? ` ${o.reportFlag === 'high' ? '↑' : '↓'}` : ''}
              </Text>
              {!!o.unit && (
                <Text style={[styles.small, { fontSize: 11, textAlign: 'right' }]}>{o.unit}</Text>
              )}
            </View>
          </Pressable>
          <View style={{ width: 44, alignItems: 'center' }}>
            {(individualReview || reviewed) && (
              <Pressable
                testID={`review-checkbox-${index}`}
                accessibilityRole="checkbox"
                accessibilityLabel={`${displayName || '未命名指标'}已核对`}
                accessibilityHint={
                  reviewDisabled
                    ? '请先填写本项的名称和结果'
                    : reviewed
                      ? '取消本项的核对确认'
                      : '对照原报告后确认本项'
                }
                accessibilityState={{ checked: reviewed, disabled: reviewDisabled }}
                disabled={reviewDisabled}
                onPress={reviewed ? onUndoReview : onReview}
                style={({ pressed }) => ({
                  width: 44,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: reviewDisabled ? 0.35 : pressed ? 0.6 : 1,
                })}
              >
                <Ionicons
                  name={reviewed ? 'checkmark-circle' : 'ellipse-outline'}
                  size={25}
                  color={reviewed ? color.green : color.muted}
                  accessible={false}
                />
              </Pressable>
            )}
          </View>
        </View>
      ) : (
        <Pressable
          testID={`observation-toggle-${index}`}
          accessibilityRole="button"
          accessibilityLabel={`第 ${index + 1} 项，${o.name || '未命名指标'}，${o.rawValue || '结果未填写'} ${o.unit}${o.needsReview ? '，待核对' : ''}${o.reportFlag ? `，原报告标记：${flag}` : ''}，参考范围：${o.reference || '未记录'}${range ? `，${range.label}` : ''}`}
          accessibilityHint={expanded ? '收起本项' : '展开本项详情'}
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={({ pressed }) => ({
            flexDirection: 'column',
            alignItems: 'stretch',
            minHeight: 76,
            padding: 16,
            backgroundColor: pressed
              ? color.bg
              : expanded && o.needsReview
                ? color.amberBg
                : color.paper,
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={[styles.body, { flex: 1, fontWeight: '500' }]}>
              {displayName || '未命名指标'}
              {!!o.unit && (
                <Text style={{ color: color.muted, fontSize: 12, fontWeight: '400' }}>
                  {' '}
                  {o.unit}
                </Text>
              )}
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              color={color.muted}
              size={14}
              accessible={false}
            />
          </View>
          <ObservationRange
            observation={o}
            index={index}
            confirmed={report.status === 'confirmed'}
          />
        </Pressable>
      )}
      {expanded && (
        <View
          testID={`observation-details-${index}`}
          style={{ padding: 16, paddingTop: 0, gap: 14 }}
        >
          <Text style={styles.small}>
            第 {index + 1} 项{document ? ` · 来源第 ${o.page + 1} 页` : ''}
          </Text>
          {document && region && (
            <SourcePreview
              document={document}
              page={o.page}
              rect={region}
              name={o.name}
              initiallyExpanded={editing && !!o.needsReview}
              index={index}
              openPage={openPage}
            />
          )}
          {editing ? (
            <>
              <Field
                label="项目"
                testID={`name-${index}`}
                value={o.name}
                onChangeText={(name) => onChange({ name, code: name === o.name ? o.code : '' })}
              />
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="结果"
                    testID={`value-${index}`}
                    value={o.rawValue}
                    onChangeText={(rawValue) => onChange({ rawValue })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="单位" value={o.unit} onChangeText={(unit) => onChange({ unit })} />
                </View>
              </View>
              <Field
                label="参考范围（按原文）"
                value={o.reference}
                onChangeText={(reference) => onChange({ reference })}
              />
              <View style={{ gap: 8 }}>
                <Text style={[styles.small, { color: color.amber }]}>{reviewCopy.item}</Text>
                <Button
                  title="本项已核对"
                  secondary
                  testID={`review-item-${index}`}
                  onPress={onReview}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.body}>原报告参考范围：{o.reference || '未记录'}</Text>
              <Button title="编辑此项" secondary onPress={onEdit} testID={`edit-item-${index}`} />
            </>
          )}
          {o.reportFlag && (
            <Text testID={`report-flag-${index}`} style={styles.small}>
              原报告标记：{flag}
            </Text>
          )}
          {!o.code && <Text style={styles.small}>这项结果暂不能与其他报告自动比较。</Text>}
          {document && (
            <Pressable
              accessibilityRole="button"
              onPress={openPage}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={[styles.small, { color: color.green }]}>
                查看来源 · 第 {o.page + 1} 页 ↗
              </Text>
            </Pressable>
          )}
          <View style={styles.between}>
            {editing && (
              <Pressable
                testID={`remove-item-${index}`}
                accessibilityRole="button"
                onPress={onRemove}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={[styles.small, { color: color.red }]}>移除此项</Text>
              </Pressable>
            )}
            <Pressable
              testID={`collapse-item-${index}`}
              accessibilityRole="button"
              onPress={onToggle}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={[styles.small, { color: color.green }]}>
                收起{editing ? '编辑' : '详情'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
