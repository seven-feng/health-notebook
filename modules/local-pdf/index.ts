import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import type { ExtractedPdf, OcrRegion, OcrRegionResult, Rect } from '../../src/domain/types';

export const LocalPdf = requireNativeModule<{
  imageToPdf(uri: string, target: string): Promise<void>;
  extract(uri: string): Promise<ExtractedPdf>;
  recognizeRegions(uri: string, regions: OcrRegion[]): Promise<OcrRegionResult[]>;
  renderRegion(
    uri: string,
    page: number,
    rect: Rect,
    target: string,
  ): Promise<{ width: number; height: number }>;
  hashFile(uri: string): Promise<string>;
  protectFile(uri: string): Promise<void>;
  getIncomingFiles(): Promise<string[]>;
  takeIncomingError?(): Promise<string | null>;
  addListener?(event: 'onIncomingFile', listener: () => void): { remove(): void };
  deleteIncomingFile(uri: string): Promise<void>;
}>('LocalPdf');
export const PdfView = requireNativeViewManager('LocalPdf') as ComponentType<
  ViewProps & { uri: string; page: number }
>;
