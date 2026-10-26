/**
 * Build a signed universal Android APK for the Tauri app.
 *
 * Tauri's Android CLI creates symlinks for the Rust .so files, which Windows
 * refuses without Developer Mode / SeCreateSymbolicLinkPrivilege. This script
 * builds the Rust libraries, copies them into jniLibs and lets Gradle package
 * them, producing the same release APK without needing symlinks.
 *
 * Requirements: JDK 17+, Android SDK (platform 36, build-tools 36), NDK 27,
 * Rust Android targets (the script tells you which one is missing).
 *
 *   pnpm android:build
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.join(root, 'apps', 'desktop')
const tauriDir = path.join(desktop, 'src-tauri')
const genAndroid = path.join(tauriDir, 'gen', 'android')
const jniLibs = path.join(genAndroid, 'app', 'src', 'main', 'jniLibs')
const isWindows = process.platform === 'win32'

const targets = [
  { rust: 'aarch64-linux-android', abi: 'arm64-v8a', flavor: 'arm64', clang: 'aarch64-linux-android24-clang' },
  { rust: 'x86_64-linux-android', abi: 'x86_64', flavor: 'x86_64', clang: 'x86_64-linux-android24-clang' },
]

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const executable = isWindows && command === 'pnpm' ? 'pnpm.cmd' : command
  console.log(`\n$ ${executable} ${args.join(' ')}`)
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: options.env ?? process.env,
    shell: isWindows && (executable.endsWith('.cmd') || executable.endsWith('.bat')),
  })
  if (result.status !== 0) fail(`${executable} exited with ${result.status}`)
}

const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  (isWindows ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : path.join(homedir(), 'Android', 'Sdk'))
if (!existsSync(sdk)) fail(`Android SDK not found at ${sdk}; set ANDROID_HOME.`)

const ndkRoot = path.join(sdk, 'ndk')
if (!existsSync(ndkRoot)) fail(`NDK not found under ${ndkRoot}; install "NDK (Side by side)".`)
const ndkVersion = process.env.NDK_HOME
  ? path.basename(process.env.NDK_HOME)
  : readdirSync(ndkRoot).sort().at(-1)
const ndk = process.env.NDK_HOME ?? path.join(ndkRoot, ndkVersion)
if (!existsSync(ndk)) fail(`NDK not found at ${ndk}.`)

function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME
  const bases = isWindows
    ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft'), path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Eclipse Adoptium')]
    : ['/Library/Java/JavaVirtualMachines', '/usr/lib/jvm']
  for (const base of bases) {
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base)) {
      if (/jdk|jbr/i.test(entry)) {
        const candidate = path.join(base, entry)
        const home = path.join(candidate, 'Contents', 'Home')
        return existsSync(path.join(home, 'bin')) ? home : candidate
      }
    }
  }
  fail('JDK 17+ not found; set JAVA_HOME.')
}
const javaHome = findJavaHome()
const prebuilt = path.join(ndk, 'toolchains', 'llvm', 'prebuilt')
const hostTag = isWindows ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64'
const ndkBin = path.join(prebuilt, hostTag, 'bin')
if (!existsSync(ndkBin)) fail(`NDK toolchain not found at ${ndkBin}.`)

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  NDK_HOME: ndk,
  PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${path.join(sdk, 'platform-tools')}${path.delimiter}${process.env.PATH ?? ''}`,
}

// Web assets are embedded into the Rust libraries.
run('pnpm', ['--filter', '@flowread/web', 'build'], { env })

// Android Gradle requires a debug keystore for the local release signing config.
const debugKeystore = path.join(homedir(), '.android', 'debug.keystore')
if (!existsSync(debugKeystore)) {
  mkdirSync(path.dirname(debugKeystore), { recursive: true })
  run(
    'keytool',
    [
      '-genkeypair',
      '-keystore', debugKeystore,
      '-storepass', 'android',
      '-alias', 'androiddebugkey',
      '-keypass', 'android',
      '-dname', 'CN=Android Debug,O=Android,C=US',
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', '10000',
    ],
    { env },
  )
}

// Build both Rust libraries and place them where Gradle expects them.
for (const target of targets) {
  const triple = target.rust.replaceAll('-', '_')
  const clang = path.join(ndkBin, `${target.clang}${isWindows ? '.cmd' : ''}`)
  const clangxx = path.join(ndkBin, `${target.clang}++${isWindows ? '.cmd' : ''}`)
  const targetEnv = {
    ...env,
    [`CARGO_TARGET_${target.rust.toUpperCase().replaceAll('-', '_')}_LINKER`]: clang,
    [`CC_${triple}`]: clang,
    [`CXX_${triple}`]: clangxx,
    [`AR_${triple}`]: path.join(ndkBin, isWindows ? 'llvm-ar.exe' : 'llvm-ar'),
    [`RANLIB_${triple}`]: path.join(ndkBin, isWindows ? 'llvm-ranlib.exe' : 'llvm-ranlib'),
  }
  run(
    'cargo',
    ['build', '--release', '--target', target.rust, '--features', 'custom-protocol'],
    { env: targetEnv, cwd: tauriDir },
  )
  const lib = path.join(tauriDir, 'target', target.rust, 'release', 'libflowread_lib.so')
  if (!existsSync(lib)) fail(`Rust library missing after build: ${lib}`)
  const outDir = path.join(jniLibs, target.abi)
  mkdirSync(outDir, { recursive: true })
  copyFileSync(lib, path.join(outDir, 'libflowread_lib.so'))
  console.log(`✓ ${target.abi} -> ${path.join(outDir, 'libflowread_lib.so')}`)
}

const configPath = path.join(tauriDir, 'tauri.conf.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const version = config.version ?? '0.1.0'

if (!existsSync(path.join(genAndroid, 'local.properties'))) {
  writeFileSync(path.join(genAndroid, 'local.properties'), `sdk.dir=${sdk.replaceAll('\\', '\\\\')}\n`)
}

const gradle = path.join(genAndroid, isWindows ? 'gradlew.bat' : 'gradlew')
const archList = targets.map((target) => target.flavor).join(',')
const abiList = targets.map((target) => target.abi).join(',')
const rustTargets = targets.map((target) => target.rust.replace('-linux-android', '').replace('armv7', 'armv7')).join(',')
const excluded = [
  'rustBuildUniversalRelease',
  ...targets.map((target) => `rustBuild${target.flavor[0].toUpperCase()}${target.flavor.slice(1)}Release`),
].flatMap((task) => ['-x', task])

run(
  gradle,
  [
    'assembleUniversalRelease',
    `-PabiList=${abiList}`,
    `-ParchList=${archList}`,
    `-PtargetList=${rustTargets}`,
    ...excluded,
    '--no-daemon',
  ],
  { env, cwd: genAndroid },
)

const apk = path.join(genAndroid, 'app', 'build', 'outputs', 'apk', 'universal', 'release', 'app-universal-release.apk')
if (!existsSync(apk)) fail(`APK not found at ${apk}`)
const outputDir = path.join(tauriDir, 'target', 'release', 'bundle', 'android')
mkdirSync(outputDir, { recursive: true })
const output = path.join(outputDir, `FlowRead_${version}_universal.apk`)
copyFileSync(apk, output)
console.log(`\n✓ APK: ${output} (${(readFileSync(output).byteLength / 1024 / 1024).toFixed(1)} MB)`)
console.log('  adb install -r "' + output + '"')
