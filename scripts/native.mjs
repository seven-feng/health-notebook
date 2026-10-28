import { statfsSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const platform = process.argv[2];
if (!['ios', 'android'].includes(platform)) throw new Error('Specify ios or android');
const disk = statfsSync(process.cwd());
const freeGiB = (disk.bavail * disk.bsize) / 1024 ** 3;
if (freeGiB < 12) {
  console.error(`可用空间 ${freeGiB.toFixed(1)} GB，建议先腾出至少 15 GB 再构建。`);
  process.exit(1);
}
const env = { ...process.env };
if (platform === 'android') {
  env.ANDROID_HOME = env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
  const jdk = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home';
  if (existsSync(jdk)) env.JAVA_HOME = jdk;
}
const result = spawnSync('npx', ['expo', `run:${platform}`, ...process.argv.slice(3)], {
  env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
