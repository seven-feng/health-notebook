import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { router } from 'expo-router';
import { LocalPdf } from '../modules/local-pdf';
import {
  database,
  getDocuments,
  getReports,
  getVisits,
  getMembers,
  retryFileDeletions,
} from './db';
import { consumeInbox, importedDestination, recoverImports } from './services/import';
import { repairMissingReportDates } from './services/repair-report-dates';
import type { DocumentRecord, Member, Report, Visit } from './domain/types';

import { SELF_ID, selfMember } from './domain/members';

type State = {
  members: Member[];
  activeMember: Member;
  reportCounts: Record<string, number>;
  visitCounts?: Record<string, number>;
  selectMember: (id: string) => void;
  reports: Report[];
  documents: DocumentRecord[];
  visits: Visit[];
  loading: boolean;
  importing: boolean;
  error: string;
  refresh: () => Promise<void>;
};
const Context = createContext<State | null>(null);
export function RecordsProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<Member[]>([selfMember]);
  const loadedMembers = useRef<Member[]>([selfMember]);
  const [activeId, setActiveId] = useState(SELF_ID);
  const selectedId = useRef(SELF_ID);
  const refreshVersion = useRef(0);
  const [reports, setReports] = useState<Report[]>([]),
    [documents, setDocuments] = useState<DocumentRecord[]>([]),
    [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      await database();
      const cleanupError = await retryFileDeletions().then(
        () => '',
        () => '部分文件尚未清理完成，可点“重新读取”重试。',
      );
      const [r, d, v, m] = await Promise.all([
        getReports(),
        getDocuments(),
        getVisits(),
        getMembers(),
      ]);
      if (version !== refreshVersion.current) return;
      loadedMembers.current = m;
      setMembers(m);
      setReports(r);
      setDocuments(d);
      setVisits(v);
      setError(cleanupError);
    } catch (e) {
      if (version === refreshVersion.current)
        setError(e instanceof Error ? e.message : '本地资料暂时无法读取。');
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    let pending = 0;
    async function startup() {
      const ownerId = selectedId.current;
      let started = false;
      // Capture member and incoming files at the foreground/link event, even if
      // OCR is still busy. Each task retains its own owner through the queue.
      const outcome = await Promise.allSettled([
        consumeInbox(ownerId, () => {
          started = true;
          pending += 1;
          if (active) setImporting(true);
        }),
        recoverImports(),
        LocalPdf.takeIncomingError?.() ?? Promise.resolve(null),
      ] as const);
      if (active) {
        await repairMissingReportDates().catch(() => {});
        await refresh();
        const failure = outcome.find((result) => result.status === 'rejected');
        const receipt = outcome[2];
        if (receipt.status === 'fulfilled' && receipt.value) setError(receipt.value);
        else if (failure?.status === 'rejected')
          setError(
            failure.reason instanceof Error ? failure.reason.message : '导入未完成，请重试。',
          );
        const imported = outcome[0];
        if (
          imported.status === 'fulfilled' &&
          imported.value.length &&
          ownerId === selectedId.current
        ) {
          const destination = await importedDestination(imported.value).catch(() => null);
          if (active && ownerId === selectedId.current && destination) router.push(destination);
        }
      }
      if (started) pending -= 1;
      if (active) setImporting(pending > 0);
    }
    // Subscribe before the first scan so receipt during startup cannot fall
    // between an empty inbox check and registration of the ready notification.
    const incoming =
      Platform.OS === 'ios'
        ? LocalPdf.addListener?.('onIncomingFile', () => void startup())
        : undefined;
    void startup();
    const subscription = AppState.addEventListener('change', (s) => {
      if (s === 'active') void startup();
    });
    const links = Linking.addEventListener('url', () => void startup());
    return () => {
      active = false;
      subscription.remove();
      links.remove();
      incoming?.remove();
    };
  }, [refresh]);
  return (
    <Context.Provider
      value={{
        members,
        activeMember: members.find((m) => m.id === activeId) ?? selfMember,
        reportCounts: Object.fromEntries(
          members.map((m) => [m.id, reports.filter((r) => r.memberId === m.id).length]),
        ),
        visitCounts: Object.fromEntries(
          members.map((m) => [m.id, visits.filter((v) => v.memberId === m.id).length]),
        ),
        selectMember: (id) => {
          if (!loadedMembers.current.some((m) => m.id === id)) return;
          selectedId.current = id;
          setActiveId(id);
        },
        reports: reports.filter((r) => r.memberId === activeId),
        documents: documents.filter((d) => d.memberId === activeId),
        visits: visits.filter((v) => v.memberId === activeId),
        loading,
        importing,
        error,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useRecords() {
  const state = useContext(Context);
  if (!state) throw new Error('RecordsProvider missing');
  return state;
}
