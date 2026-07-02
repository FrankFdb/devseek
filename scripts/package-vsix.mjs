import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const extensionRoot = path.join(root, 'packages', 'vscode-extension');
const pkg = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
const outFile = path.join(root, 'devseek-netai-latest.vsix');
const packageOutFile = path.join(extensionRoot, 'devseek-netai-latest.vsix');
const staging = mkdtempSync(path.join(tmpdir(), 'devseek-vsix-'));
const buildInfo = resolveBuildInfo();
const versionedOutFile = path.join(root, `devseek-netai-${buildInfo.packageVersion}.vsix`);
const versionedPackageOutFile = path.join(extensionRoot, `devseek-netai-${buildInfo.packageVersion}.vsix`);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function copy(relPath, targetRelPath = relPath) {
  cpSync(path.join(extensionRoot, relPath), path.join(staging, 'extension', targetRelPath), {
    recursive: true,
    force: true,
  });
}

function copyFromRoot(relPath, targetRelPath = relPath) {
  cpSync(path.join(root, relPath), path.join(staging, 'extension', targetRelPath), {
    recursive: true,
    force: true,
  });
}

function localBuildStamp(now = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return {
    date: `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    time: `t${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    iso: now.toISOString(),
  };
}

function getGitCommit() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : 'local';
}

function resolveBuildInfo() {
  const channel = String(process.env.DEVSEEK_BUILD_CHANNEL || 'debug').trim().toLowerCase() === 'release'
    ? 'release'
    : 'debug';
  const baseVersion = String(pkg.version || '0.0.0').replace(/-.+$/, '');
  const stamp = localBuildStamp();
  const gitCommit = getGitCommit().replace(/[^0-9A-Za-z-]/g, '').slice(0, 12) || 'local';
  const packageVersion = channel === 'release'
    ? baseVersion
    : `${baseVersion}-debug.${stamp.date}.${stamp.time}.g${gitCommit}`;
  return {
    baseVersion,
    packageVersion,
    channel,
    buildId: `${stamp.date}-${stamp.time}`,
    packagedAt: stamp.iso,
    gitCommit,
  };
}

function buildPackagedPackageJson() {
  const packaged = JSON.parse(JSON.stringify(pkg));
  packaged.version = buildInfo.packageVersion;
  packaged.devseekBuild = {
    baseVersion: buildInfo.baseVersion,
    channel: buildInfo.channel,
    buildId: buildInfo.buildId,
    gitCommit: buildInfo.gitCommit,
    packagedAt: buildInfo.packagedAt,
  };
  const traceConfig = packaged.contributes?.configuration?.properties?.['devseek.traceLevel'];
  if (traceConfig) {
    traceConfig.default = buildInfo.channel === 'release' ? 'info' : 'debug';
  }
  return packaged;
}

function writePackagedPackageJson() {
  writeFileSync(
    path.join(staging, 'extension', 'package.json'),
    `${JSON.stringify(buildPackagedPackageJson(), null, 2)}\n`,
    'utf8',
  );
}

function bundleBridgeServer() {
  const bridgeDir = path.join(staging, 'extension', 'bridge');
  mkdirSync(bridgeDir, { recursive: true });
  const result = spawnSync('npx', [
    'esbuild',
    'packages/bridge/src/server.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${path.join(bridgeDir, 'server.js')}`,
    '--external:playwright',
  ], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`bridge bundle failed with status ${result.status}`);
  }
}

function generateWebviewToolManifest() {
  const result = spawnSync('node', ['scripts/generate-webview-tool-manifest.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`webview tool manifest generation failed with status ${result.status}`);
  }
}

try {
  generateWebviewToolManifest();
  mkdirSync(path.join(staging, 'extension'), { recursive: true });

  writePackagedPackageJson();
  copy('LICENSE', 'LICENSE.txt');
  copy('dist');
  copy('test');
  const runtimeManifest = JSON.parse(readFileSync(path.join(extensionRoot, 'media', 'webview-runtime.json'), 'utf8'));
  const webviewRuntimeFiles = Array.isArray(runtimeManifest.scripts) && runtimeManifest.scripts.length > 0
    ? runtimeManifest.scripts
    : ['webview.js'];
  for (const mediaFile of new Set([
    'codicon.css',
    'codicon.ttf',
    'icon.svg',
    'marked.umd.js',
    'mermaid.min.js',
    'webview-runtime.json',
    ...webviewRuntimeFiles,
  ])) {
    copy(path.join('media', mediaFile));
  }
  bundleBridgeServer();
  copyFromRoot('node_modules/playwright', 'node_modules/playwright');
  copyFromRoot('node_modules/playwright-core', 'node_modules/playwright-core');

  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(pkg.name)}" Version="${escapeXml(buildInfo.packageVersion)}" Publisher="${escapeXml(pkg.publisher)}" />
    <DisplayName>${escapeXml(pkg.displayName ?? pkg.name)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(pkg.description ?? '')}</Description>
    <Tags>keybindings</Tags>
    <Categories>${escapeXml((pkg.categories ?? []).join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(pkg.engines?.vscode ?? '*')}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
  </Assets>
</PackageManifest>`;

  const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="map" ContentType="application/json" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="ttf" ContentType="application/octet-stream" />
  <Default Extension="woff" ContentType="font/woff" />
  <Default Extension="woff2" ContentType="font/woff2" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="jpg" ContentType="image/jpeg" />
  <Default Extension="jpeg" ContentType="image/jpeg" />
  <Default Extension="gif" ContentType="image/gif" />
  <Default Extension="webp" ContentType="image/webp" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="mjs" ContentType="application/javascript" />
  <Default Extension="cjs" ContentType="application/javascript" />
  <Default Extension="node" ContentType="application/octet-stream" />
  <Default Extension="cmd" ContentType="text/plain" />
  <Default Extension="ps1" ContentType="text/plain" />
  <Default Extension="sh" ContentType="text/plain" />
  <Default Extension="yml" ContentType="text/yaml" />
  <Default Extension="yaml" ContentType="text/yaml" />
  <Default Extension="wasm" ContentType="application/wasm" />
</Types>`;

  writeFileSync(path.join(staging, 'extension.vsixmanifest'), manifest, 'utf8');
  writeFileSync(path.join(staging, '[Content_Types].xml'), contentTypes, 'utf8');

  rmSync(outFile, { force: true });
  rmSync(packageOutFile, { force: true });
  rmSync(versionedOutFile, { force: true });
  rmSync(versionedPackageOutFile, { force: true });

  const zipResult = spawnSync('zip', ['-qr', outFile, 'extension.vsixmanifest', '[Content_Types].xml', 'extension'], {
    cwd: staging,
    stdio: 'inherit',
  });
  if (zipResult.status !== 0) {
    throw new Error(`zip failed with status ${zipResult.status}`);
  }

  cpSync(outFile, packageOutFile, { force: true });
  cpSync(outFile, versionedOutFile, { force: true });
  cpSync(outFile, versionedPackageOutFile, { force: true });
  console.log(`Packaged ${outFile}`);
  console.log(`Packaged ${versionedOutFile}`);
  console.log(`Copied ${packageOutFile}`);
  console.log(`Copied ${versionedPackageOutFile}`);
  console.log(`DevSeek build: ${buildInfo.packageVersion} (${buildInfo.channel}, ${buildInfo.gitCommit})`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
