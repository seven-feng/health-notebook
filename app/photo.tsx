import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FS from 'expo-file-system/legacy';
import { LocalPdf } from '../modules/local-pdf';
import { PhotoCrop } from '../src/components/PhotoCrop';
import { fullCrop, pixelCrop } from '../src/domain/photo-crop';
import { importReportImage, importedDestination } from '../src/services/import';
import { useRecords } from '../src/state';
import { Button, color, Screen, styles } from '../src/ui';

export default function PhotoImport() {
  const { source, memberId } = useLocalSearchParams<{ source?: string; memberId?: string }>();
  const navigation = useNavigation();
  const { refresh, activeMember } = useRecords();
  const [importMemberId] = useState(memberId ?? activeMember.id);
  const [image, setImage] = useState<ImageManipulator.ImageResult>();
  const [crop, setCrop] = useState(fullCrop);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const pending = useRef(false);
  const started = useRef(false);
  const alive = useRef(true);
  const files = useRef(new Set<string>());
  const keep = (uri: string) => {
    if (FS.cacheDirectory && uri.startsWith(FS.cacheDirectory)) files.current.add(uri);
  };
  function lock(value: boolean) {
    pending.current = value;
    if (alive.current) setBusy(value);
  }
  useEffect(() => {
    alive.current = true;
    const remove = navigation.addListener('beforeRemove', (event) => {
      if (pending.current) event.preventDefault();
    });
    const cached = files.current;
    return () => {
      alive.current = false;
      remove();
      for (const uri of cached) void FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
    };
  }, [navigation]);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void choose(source === 'camera' ? 'camera' : 'library', true);
    }
    // Open the native picker once for this screen, never again after a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(kind: 'camera' | 'library', recover = false) {
    if (pending.current) return;
    lock(true);
    setMessage('');
    setPermissionDenied(false);
    try {
      const recovered = recover ? await ImagePicker.getPendingResultAsync() : null;
      if (recovered && !('canceled' in recovered)) throw new Error('图片未能恢复，请重新选择。');
      if (!recovered && kind === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setPermissionDenied(true);
          setMessage('未开启相机权限。可以前往设置开启，或从相册选择报告。');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        exif: false,
        base64: false,
      };
      const result =
        recovered ??
        (kind === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options));
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      keep(asset.uri);
      if (FS.cacheDirectory && asset.uri.startsWith(FS.cacheDirectory))
        await LocalPdf.protectFile(asset.uri);
      if (
        !asset.width ||
        !asset.height ||
        asset.width * asset.height > 24_000_000 ||
        (asset.fileSize ?? 0) > 40 * 1024 * 1024
      )
        throw new Error('图片过大或无效，请选择 40 MB、2400 万像素以内的图片。');
      setMessage('正在准备图片…');
      const normalized = await ImageManipulator.manipulateAsync(
        asset.uri,
        [
          {
            resize:
              asset.width >= asset.height
                ? { width: Math.min(asset.width, 3200) }
                : { height: Math.min(asset.height, 3200) },
          },
        ],
        { format: ImageManipulator.SaveFormat.JPEG, compress: 1 },
      );
      keep(normalized.uri);
      await LocalPdf.protectFile(normalized.uri);
      setImage(normalized);
      setCrop(fullCrop);
      setMessage('');
    } catch (error) {
      setMessage(
        error instanceof Error && error.message.startsWith('图片')
          ? error.message
          : kind === 'camera'
            ? '这台设备暂时无法拍照，可以从相册选择报告。'
            : '无法读取这张图片，请选择已下载到本机的清晰图片。',
      );
    } finally {
      lock(false);
    }
  }
  async function rotate() {
    if (!image || pending.current) return;
    lock(true);
    try {
      const rotated = await ImageManipulator.manipulateAsync(image.uri, [{ rotate: 90 }], {
        format: ImageManipulator.SaveFormat.JPEG,
        compress: 1,
      });
      keep(rotated.uri);
      await LocalPdf.protectFile(rotated.uri);
      setImage(rotated);
      setCrop(fullCrop);
    } catch {
      setMessage('旋转未完成，请重试。');
    } finally {
      lock(false);
    }
  }
  async function recognize() {
    if (!image || pending.current) return;
    lock(true);
    setMessage('正在本机识别，请稍候…');
    try {
      const cropped = await ImageManipulator.manipulateAsync(
        image.uri,
        [{ crop: pixelCrop(crop, image.width, image.height) }],
        { format: ImageManipulator.SaveFormat.JPEG, compress: 1 },
      );
      keep(cropped.uri);
      await LocalPdf.protectFile(cropped.uri);
      const result = await importReportImage(cropped.uri, importMemberId);
      await refresh();
      if (result.duplicate) Alert.alert('这份资料已导入', '已打开已有记录。');
      lock(false);
      if (result.ids[0]) router.replace(await importedDestination(result.ids));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '识别未完成，请重试。');
      await refresh();
    } finally {
      lock(false);
    }
  }
  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, padding: 20, paddingBottom: 32, gap: 14 }}>
        <View style={styles.between}>
          <Text style={styles.h2}>整理资料图片</Text>
          <Button title="返回" secondary disabled={busy} onPress={() => router.back()} />
        </View>
        <Text style={styles.subtitle}>
          一次一张。拖动四角裁剪，保留姓名、日期和完整内容；文字尽量清晰、摆正。
        </Text>
        {image ? (
          <PhotoCrop image={image} crop={crop} onChange={setCrop} disabled={busy} />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={styles.subtitle}>选择清晰的门诊病历或检验报告</Text>
          </View>
        )}
        {!!message && (
          <Text accessibilityLiveRegion="polite" style={styles.small}>
            {message}
          </Text>
        )}
        {busy && <ActivityIndicator color={color.green} />}
        {permissionDenied && (
          <Button title="打开系统设置" secondary onPress={() => void Linking.openSettings()} />
        )}
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Button
              title="拍照"
              icon="camera-outline"
              secondary
              disabled={busy}
              testID="photo-camera"
              onPress={() => void choose('camera')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="选图片"
              icon="images-outline"
              secondary
              disabled={busy}
              testID="photo-library"
              onPress={() => void choose('library')}
            />
          </View>
        </View>
        {image && (
          <>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button
                  title="旋转"
                  secondary
                  disabled={busy}
                  testID="photo-rotate"
                  onPress={() => void rotate()}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="恢复裁剪"
                  secondary
                  disabled={busy}
                  onPress={() => setCrop(fullCrop)}
                />
              </View>
            </View>
            <Button
              title="开始识别"
              testID="photo-recognize"
              busy={busy}
              onPress={() => void recognize()}
            />
          </>
        )}
        <Text style={[styles.small, { textAlign: 'center' }]}>
          只在本机处理。保存裁剪后的报告，不修改相册原图。
        </Text>
      </View>
    </Screen>
  );
}
