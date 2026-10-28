import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { DocumentRecord } from '../domain/types';
import { sourcePreview, type SourceImage } from '../services/source-preview';
import { Button, color, PageScrollContext, styles } from '../ui';
import { ZoomableSourceImage } from './ZoomableSourceImage';

export function PhotoOriginal({ document }: { document: DocumentRecord }) {
  const [image, setImage] = useState<SourceImage>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [height, setHeight] = useState(300);
  const { id, uri, pageCount } = document;
  useEffect(() => {
    let active = true;
    setImage(undefined);
    setError(false);
    void sourcePreview({ id, uri, pageCount }, 0, { x: 0, y: 0, width: 1, height: 1 }, retry > 0)
      .then((result) => {
        if (active) setImage(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [id, uri, pageCount, retry]);
  return (
    <PageScrollContext.Provider value={null}>
      <View
        style={{ flex: 1, justifyContent: 'center', backgroundColor: color.paper }}
        onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
      >
        {error ? (
          <View style={{ padding: 20, gap: 12 }}>
            <Text style={styles.body}>图片暂时无法显示，请重试。</Text>
            <Button title="重新加载图片" secondary onPress={() => setRetry(retry + 1)} />
          </View>
        ) : image ? (
          <ZoomableSourceImage
            image={image}
            name="报告图片"
            index={0}
            viewportHeight={height}
            onError={() => setError(true)}
          />
        ) : (
          <ActivityIndicator color={color.green} />
        )}
      </View>
    </PageScrollContext.Provider>
  );
}
