import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import PDF from '../../app/pdf/[id]';
import { useRecords } from '../../src/state';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'document', page: '0' }),
}));
jest.mock('../../src/state', () => ({ useRecords: jest.fn() }));
jest.mock('../../modules/local-pdf', () => ({ PdfView: 'PdfView' }));
jest.mock('../../src/components/PhotoOriginal', () => ({ PhotoOriginal: 'PhotoOriginal' }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
beforeEach(() => jest.clearAllMocks());

test.each([undefined, 'image'])(
  'original %s opens management of the same document',
  (sourceType) => {
    jest
      .mocked(useRecords)
      .mockReturnValue({
        documents: [
          {
            id: 'document',
            fileName: '合成报告.pdf',
            sourceType,
            pageCount: 2,
            uri: 'file:///synthetic.pdf',
          },
        ],
      } as never);
    const screen = render(<PDF />);
    fireEvent.press(screen.getByTestId('manage-document'));
    expect(router.replace).toHaveBeenCalledWith('/document/document');
  },
);
test('a missing or another member’s original has no management entry', () => {
  jest.mocked(useRecords).mockReturnValue({ documents: [] } as never);
  const screen = render(<PDF />);
  expect(screen.queryByTestId('manage-document')).toBeNull();
  expect(screen.getByText('原件不存在。')).toBeTruthy();
});
