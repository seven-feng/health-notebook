import { act, fireEvent, render } from '@testing-library/react-native';
import * as Picker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import * as FS from 'expo-file-system/legacy';
import { router, useLocalSearchParams } from 'expo-router';
import { importReportImage, importedDestination } from '../../src/services/import';
import PhotoImport from '../../app/photo';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ source: 'library' })),
  useNavigation: () => ({ addListener: () => () => {} }),
}));
jest.mock('expo-image-picker', () => ({
  getPendingResultAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn(),
}));
jest.mock('../../modules/local-pdf', () => ({ LocalPdf: { protectFile: jest.fn() } }));
jest.mock('../../src/services/import', () => ({
  importReportImage: jest.fn(),
  importedDestination: jest.fn(async () => '/report/new-photo'),
}));
jest.mock('../../src/state', () => ({
  useRecords: () => ({ activeMember: { id: 'mom' }, refresh: jest.fn(async () => {}) }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({ source: 'library' });
  jest.mocked(FS.deleteAsync).mockResolvedValue();
  jest.mocked(Picker.getPendingResultAsync).mockResolvedValue(null);
  jest.mocked(Picker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/picked.jpg', width: 2000, height: 3000 }],
  });
  jest
    .mocked(Manipulator.manipulateAsync)
    .mockResolvedValue({ uri: 'file:///cache/normalized.jpg', width: 2000, height: 3000 });
  jest.mocked(importReportImage).mockResolvedValue({ ids: ['new-photo'], duplicate: false });
});

test('canceling the system picker creates no report and leaves a usable choice screen', async () => {
  jest.mocked(Picker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null });
  const screen = render(<PhotoImport />);
  await act(async () => {});
  expect(screen.getByTestId('photo-library')).toBeTruthy();
  expect(screen.queryByTestId('photo-recognize')).toBeNull();
  expect(importReportImage).not.toHaveBeenCalled();
});

test('denied camera permission offers settings and the album without launching the camera', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ source: 'camera' });
  jest.mocked(Picker.requestCameraPermissionsAsync).mockResolvedValue({ granted: false } as never);
  const screen = render(<PhotoImport />);
  await act(async () => {});
  expect(screen.getByText('打开系统设置')).toBeTruthy();
  expect(Picker.launchCameraAsync).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('photo-library'));
  });
  expect(screen.getByTestId('photo-recognize')).toBeTruthy();
});

test('only explicit recognition imports the edited image, then opens review and cleans cache copies', async () => {
  const screen = render(<PhotoImport />);
  await act(async () => {});
  expect(importReportImage).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('photo-rotate'));
  });
  expect(Manipulator.manipulateAsync).toHaveBeenCalledWith(
    'file:///cache/normalized.jpg',
    [{ rotate: 90 }],
    expect.anything(),
  );
  await act(async () => {
    fireEvent.press(screen.getByTestId('photo-recognize'));
  });
  expect(importReportImage).toHaveBeenCalledWith('file:///cache/normalized.jpg', 'mom');
  expect(router.replace).toHaveBeenCalledWith('/report/new-photo');
  screen.unmount();
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///cache/picked.jpg', { idempotent: true });
});

test('failed recognition stays in the editor and offers retry without clearing the selected image', async () => {
  jest.mocked(importReportImage).mockRejectedValue(new Error('原件已保留，请重试。'));
  const screen = render(<PhotoImport />);
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByTestId('photo-recognize'));
  });
  expect(screen.getByText('原件已保留，请重试。')).toBeTruthy();
  expect(screen.getByTestId('photo-editor')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
});

test('an Android picker result recovered after activity recreation opens the editor without launching another picker', async () => {
  jest.mocked(Picker.getPendingResultAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/recovered.jpg', width: 2000, height: 3000 }],
  });
  const screen = render(<PhotoImport />);
  await act(async () => {});
  expect(screen.getByTestId('photo-recognize')).toBeTruthy();
  expect(Picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(importReportImage).not.toHaveBeenCalled();
});

test('photo route retains its captured member when the current context names another member', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ source: 'library', memberId: 'dad' });
  const screen = render(<PhotoImport />);
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByTestId('photo-recognize'));
  });
  expect(importReportImage).toHaveBeenCalledWith('file:///cache/normalized.jpg', 'dad');
});

test('photo recognition follows the shared visit destination instead of forcing lab review', async () => {
  jest.mocked(importedDestination).mockResolvedValueOnce('/visit?id=visit-photo');
  const screen = render(<PhotoImport />);
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByTestId('photo-recognize'));
  });
  expect(importedDestination).toHaveBeenCalledWith(['new-photo']);
  expect(router.replace).toHaveBeenCalledWith('/visit?id=visit-photo');
});
