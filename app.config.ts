import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: '健康小本',
  slug: 'doctor-records',
  version: '0.1.0',
  scheme: 'doctorrecords',
  orientation: 'portrait',
  icon: './assets/brand/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'com.local.doctorrecords',
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: true,
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'PDF 报告',
          LSHandlerRank: 'Alternate',
          LSItemContentTypes: ['com.adobe.pdf'],
          CFBundleTypeRole: 'Viewer',
        },
      ],
      LSSupportsOpeningDocumentsInPlace: true,
    },
  },
  android: {
    package: 'com.local.doctorrecords',
    adaptiveIcon: {
      foregroundImage: './assets/brand/adaptive-icon.png',
      backgroundColor: '#F7F8F3',
    },
    allowBackup: false,
    intentFilters: [
      { action: 'VIEW', category: ['DEFAULT'], data: [{ mimeType: 'application/pdf' }] },
      { action: 'SEND', category: ['DEFAULT'], data: [{ mimeType: 'application/pdf' }] },
    ],
  },
  plugins: [
    'expo-router',
    'expo-asset',
    'expo-font',
    [
      'expo-image-picker',
      {
        cameraPermission: '拍摄门诊病历或检验报告，在本机识别并整理记录。',
        photosPermission: '选择门诊病历或检验报告图片，在本机识别并整理记录。',
        microphonePermission: false,
      },
    ],
    ['expo-sqlite', { useSQLCipher: true }],
    ['expo-secure-store', { configureAndroidBackup: false }],
    './plugins/with-local-files',
  ],
  experiments: { typedRoutes: false },
};
export default config;
