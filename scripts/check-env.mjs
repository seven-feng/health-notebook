import { statfsSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const sdk = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const jdk =
  process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home';
const java = existsSync(`${jdk}/bin/java`) ? `${jdk}/bin/java` : 'java';
for (const [label, command, args] of [
  ['Node', 'node', ['--version']],
  ['Xcode', 'xcodebuild', ['-version']],
  ['CocoaPods', 'pod', ['--version']],
  ['项目 JDK', java, ['-version']],
  ['Android adb', `${sdk}/platform-tools/adb`, ['version']],
]) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  console.log(
    `${label}: ${(result.stdout || result.stderr || '不可用').trim().split('\n').slice(0, 2).join(' / ')}`,
  );
}
const s = statfsSync(process.cwd());
console.log(`可用空间：${((s.bavail * s.bsize) / 1024 ** 3).toFixed(1)} GB`);
