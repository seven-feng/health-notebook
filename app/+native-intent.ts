export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.startsWith('file:') || path.startsWith('content:')) return '/';
  return path;
}
