import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
const platform = process.argv[2];
if (!['ios', 'android'].includes(platform)) throw new Error('Specify ios or android');
const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' };
const metroPort = process.env.DOCTOR_METRO_PORT || '8081';
if (!/^\d{1,5}$/.test(metroPort) || Number(metroPort) < 1 || Number(metroPort) > 65535)
  throw new Error('DOCTOR_METRO_PORT must be a valid port');
const localJdk = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home';
if (!env.JAVA_HOME && existsSync(localJdk)) env.JAVA_HOME = localJdk;
if (env.JAVA_HOME) env.PATH = `${env.JAVA_HOME}/bin:${env.PATH}`;
const maestro = existsSync('.local/tools/maestro/bin/maestro')
  ? '.local/tools/maestro/bin/maestro'
  : 'maestro';
let device = env.DOCTOR_TEST_DEVICE;
if (!device && platform === 'ios') {
  const result = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], {
    encoding: 'utf8',
  });
  const devices = Object.values(JSON.parse(result.stdout).devices).flat();
  if (devices.length === 1) device = devices[0].udid;
}
const adb = `${env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`}/platform-tools/adb`;
if (!device && platform === 'android') {
  const result = spawnSync(adb, ['devices'], { encoding: 'utf8' });
  const devices = result.stdout.split('\n').filter((x) => /^emulator-\d+\s+device$/.test(x.trim()));
  if (devices.length === 1) device = devices[0].split(/\s/)[0];
}
if (!device) {
  console.error('请启动一个模拟器，或用 DOCTOR_TEST_DEVICE 指定测试设备。');
  process.exit(1);
}
if (platform === 'android')
  spawnSync(adb, ['-s', device, 'reverse', `tcp:${metroPort}`, `tcp:${metroPort}`], {
    stdio: 'inherit',
  });
mkdirSync(`test-results/${platform}`, { recursive: true });
const flow = process.argv[3] || '.maestro/core.yaml';
const fixtures =
  basename(flow) === 'core.yaml'
    ? ['sample-first.pdf', 'sample-second.pdf']
    : basename(flow) === 'unsupported.yaml'
      ? ['sample-unsupported.pdf']
      : basename(flow) === 'sections.yaml'
        ? ['sample-sections.pdf']
        : [];
// Test setup uses the real incoming-file pipeline; no fixture controls or PDFs
// are bundled into the app. Never seed or stop a physical phone for this setup.
if (fixtures.length) {
  const appId = 'com.local.doctorrecords';
  function command(program, args, options = {}) {
    const result = spawnSync(program, args, { encoding: 'utf8', ...options });
    if (result.error || result.status !== 0)
      throw new Error(result.error?.message || result.stderr || `${program} failed`);
    return result.stdout.trim();
  }
  if (platform === 'ios') {
    const devices = Object.values(
      JSON.parse(command('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'])).devices,
    ).flat();
    if (!devices.some((item) => item.udid === device))
      throw new Error('合成样本测试仅支持已启动的 iOS 模拟器。');
    const container = command('xcrun', ['simctl', 'get_app_container', device, appId, 'data']);
    // A stopped app may return a nonzero status here; no data is cleared.
    spawnSync('xcrun', ['simctl', 'terminate', device, appId], { stdio: 'ignore' });
    const inbox = join(container, 'Library', 'Application Support', 'incoming');
    mkdirSync(inbox, { recursive: true });
    for (const file of fixtures) copyFileSync(join('assets/samples', file), join(inbox, file));
  } else {
    if (!/^emulator-\d+$/.test(device)) throw new Error('合成样本测试仅支持 Android 模拟器。');
    command(adb, ['-s', device, 'shell', 'am', 'force-stop', appId]);
    command(adb, ['-s', device, 'shell', 'run-as', appId, 'mkdir', '-p', 'files/incoming']);
    for (const file of fixtures)
      command(
        adb,
        ['-s', device, 'shell', `run-as ${appId} sh -c 'cat > files/incoming/${file}'`],
        {
          input: readFileSync(join('assets/samples', file)),
        },
      );
  }
}
const result = spawnSync(
  maestro,
  [
    '--device',
    device,
    'test',
    '-e',
    `DEV_SERVER=http://${platform === 'android' ? '10.0.2.2' : 'localhost'}:${metroPort}`,
    '-e',
    `DEV_LINK=exp+doctor-records://expo-development-client/?url=${encodeURIComponent(`http://${platform === 'android' ? '10.0.2.2' : 'localhost'}:${metroPort}`)}`,
    flow,
    '--test-output-dir',
    `test-results/${platform}`,
  ],
  { env, stdio: 'inherit' },
);
if (result.error) console.error('找不到 Maestro，请从官方发布页安装 Maestro 2.11.0。');
process.exit(result.status ?? 1);
