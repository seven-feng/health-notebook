import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PdfView } from '../../modules/local-pdf';
import { Button, color, Screen, styles } from '../../src/ui';
import { useRecords } from '../../src/state';
import { PhotoOriginal } from '../../src/components/PhotoOriginal';
export default function PDF() {
  const { id, page: initial } = useLocalSearchParams<{ id: string; page?: string }>();
  const { documents } = useRecords();
  const doc = documents.find((d) => d.id === id);
  const [page, setPage] = useState(Number(initial) || 0);
  return (
    <Screen scroll={false}>
      <View style={{ padding: 18, gap: 12 }}>
        <View style={styles.between}>
          <Button title="返回报告" onPress={() => router.back()} secondary />
          {doc && (
            <Pressable
              testID="manage-document"
              accessibilityRole="button"
              accessibilityLabel="管理报告"
              onPress={() => router.replace(`/document/${doc.id}`)}
              style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}
            >
              <Text style={{ color: color.green, fontSize: 14 }}>管理报告</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.small}>
          {doc?.sourceType === 'image' ? '报告图片 · 双指缩放查看' : doc?.fileName || 'PDF 原件'}
        </Text>
      </View>
      {doc?.sourceType === 'image' ? (
        <PhotoOriginal document={doc} />
      ) : doc ? (
        <>
          <PdfView uri={doc.uri} page={page} style={{ flex: 1, backgroundColor: color.paper }} />
          <View style={[styles.between, { padding: 18, paddingBottom: 32 }]}>
            <Button
              title="上一页"
              secondary
              disabled={page <= 0}
              onPress={() => setPage(page - 1)}
            />
            <Text style={styles.small}>
              {doc.pageCount > 0 ? `${page + 1} / ${doc.pageCount}` : '页数未知'}
            </Text>
            <Button
              title="下一页"
              secondary
              disabled={page >= doc.pageCount - 1}
              onPress={() => setPage(page + 1)}
            />
          </View>
        </>
      ) : (
        <Text style={styles.body}>原件不存在。</Text>
      )}
    </Screen>
  );
}
