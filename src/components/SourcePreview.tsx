import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Modal,
  Pressable,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DocumentRecord, Rect } from '../domain/types';
import { sourcePreview, type SourceImage } from '../services/source-preview';
import { Button, color, PageScrollContext, styles } from '../ui';
import { ZoomableSourceImage } from './ZoomableSourceImage';

export function SourcePreview({
  document,
  page,
  rect,
  name,
  initiallyExpanded,
  index,
  openPage,
  fitContent = false,
  initialImage,
  initialWidth = 0,
}: {
  document: DocumentRecord;
  page: number;
  rect: Rect;
  name: string;
  initiallyExpanded: boolean;
  index: number;
  openPage: () => void;
  fitContent?: boolean;
  initialImage?: SourceImage;
  initialWidth?: number;
}) {
  const insets = useSafeAreaInsets();
  const [requested, setRequested] = useState(initiallyExpanded);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerHeight, setViewerHeight] = useState(240);
  const [previewWidth, setPreviewWidth] = useState(initialWidth);
  const [result, setResult] = useState<SourceImage | undefined>(initialImage);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const { x, y, width, height } = rect;
  const { id: documentId, uri: documentUri, pageCount } = document;
  useEffect(() => {
    if (initiallyExpanded) setRequested(true);
  }, [initiallyExpanded]);
  useEffect(() => {
    let active = true;
    setResult(retry === 0 ? initialImage : undefined);
    setError(false);
    if (requested && (!initialImage || retry > 0))
      void sourcePreview(
        { id: documentId, uri: documentUri, pageCount },
        page,
        {
          x,
          y,
          width,
          height,
        },
        retry > 0,
      )
        .then((image) => {
          if (active) setResult(image);
        })
        .catch(() => {
          if (active) setError(true);
        });
    return () => {
      active = false;
    };
  }, [
    documentId,
    documentUri,
    pageCount,
    page,
    x,
    y,
    width,
    height,
    requested,
    retry,
    initialImage,
  ]);
  const image = result && !error ? result : undefined;
  function openViewer() {
    Keyboard.dismiss();
    setRequested(true);
    setViewerOpen(true);
  }
  const closeViewer = () => setViewerOpen(false);
  const fallback = (
    <View style={{ gap: 8 }}>
      <Text style={styles.small}>原文片段暂时无法显示。</Text>
      <View style={styles.row}>
        <Button title="重试" secondary onPress={() => setRetry(retry + 1)} />
        <Button
          title="查看整页"
          secondary
          onPress={() => {
            closeViewer();
            openPage();
          }}
        />
      </View>
    </View>
  );
  return (
    <>
      {error ? (
        fallback
      ) : (
        <Pressable
          testID={`source-toggle-${index}`}
          accessibilityRole="button"
          accessibilityLabel={`放大查看${name}的原文，第 ${page + 1} 页`}
          accessibilityHint="打开大图，可双指缩放"
          onPress={openViewer}
          onLayout={({ nativeEvent }) => setPreviewWidth(nativeEvent.layout.width)}
          style={({ pressed }) => [
            styles.between,
            {
              minHeight: image || requested ? 64 : 44,
              paddingHorizontal: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: color.line,
              backgroundColor: color.paper,
              opacity: pressed ? 0.65 : 1,
            },
          ]}
        >
          {image ? (
            <Image
              testID={`source-thumbnail-${index}`}
              source={{ uri: image.uri }}
              resizeMode="contain"
              accessible={false}
              onError={() => setError(true)}
              style={{
                flex: 1,
                height: fitContent
                  ? Math.max(
                      76,
                      Math.min(280, (((previewWidth || 320) - 44) * image.height) / image.width),
                    )
                  : 62,
              }}
            />
          ) : requested ? (
            <View style={[styles.row, { flex: 1 }]}>
              <ActivityIndicator color={color.green} size="small" />
              <Text style={styles.small}>加载原文…</Text>
            </View>
          ) : (
            <Text style={[styles.small, { color: color.green, flex: 1 }]}>查看原文</Text>
          )}
          <Ionicons name="expand-outline" color={color.green} size={17} accessible={false} />
        </Pressable>
      )}
      {viewerOpen && (
        <Modal
          transparent
          statusBarTranslucent
          navigationBarTranslucent
          animationType="fade"
          supportedOrientations={['portrait', 'landscape']}
          onRequestClose={closeViewer}
        >
          <StatusBar barStyle="light-content" />
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#101C18' }}>
            <PageScrollContext.Provider value={null}>
              <View
                style={{
                  flex: 1,
                  paddingTop: insets.top,
                  paddingBottom: insets.bottom,
                  paddingLeft: insets.left,
                  paddingRight: insets.right,
                }}
                accessibilityViewIsModal
                onAccessibilityEscape={closeViewer}
              >
                <View style={[styles.between, { paddingLeft: 20, paddingRight: 8, minHeight: 64 }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.body, { color: 'white' }]} numberOfLines={2}>
                      {name}
                    </Text>
                    <Text style={[styles.small, { color: '#BFCBC5' }]}>
                      原报告 · 第 {page + 1} 页
                    </Text>
                  </View>
                  <Pressable
                    testID="close-source-preview"
                    accessibilityRole="button"
                    accessibilityLabel="关闭原图"
                    onPress={closeViewer}
                    style={{
                      width: 48,
                      height: 48,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="close" size={26} color="white" accessible={false} />
                  </Pressable>
                </View>
                <View
                  style={{ flex: 1, justifyContent: 'center' }}
                  onLayout={({ nativeEvent }) => setViewerHeight(nativeEvent.layout.height)}
                >
                  {error ? (
                    <View
                      style={{
                        padding: 20,
                        margin: 20,
                        borderRadius: 12,
                        backgroundColor: color.paper,
                      }}
                    >
                      {fallback}
                    </View>
                  ) : image ? (
                    <ZoomableSourceImage
                      key={image.uri}
                      image={image}
                      name={name}
                      index={index}
                      viewportHeight={viewerHeight}
                      backgroundColor="transparent"
                      onError={() => setError(true)}
                    />
                  ) : (
                    <ActivityIndicator color="white" />
                  )}
                </View>
              </View>
            </PageScrollContext.Provider>
          </GestureHandlerRootView>
        </Modal>
      )}
    </>
  );
}
