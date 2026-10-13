import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const helper = fileURLToPath(new URL('../tools/edge-auto-profile.ps1', import.meta.url));
const profile = String.raw`C:\Users\ITP\AppData\Local\JSMap\EdgeAutoCollector\profile`;
const psLiteral = text => "'" + text.replaceAll("'", "''") + "'";

function powershell(script) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); . " + psLiteral(helper) + '; ' + script],
  { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return JSON.parse(result.stdout.trim());
}

test('launcher enumerates JSON-array debug targets before finding or cleaning individual tabs', { skip: process.platform !== 'win32' }, () => {
  const launcher = fs.readFileSync(new URL('../tools/run-edge-auto-collector.ps1', import.meta.url), 'utf8');
  const debugHelper = launcher.match(/function Get-EdgeAutoDebugPages \{[\s\S]*?\r?\n\}/)?.[0];
  assert.ok(debugHelper);
  const result = powershell(`
    function Invoke-RestMethod {
      return ,@(
        [pscustomobject]@{ id='first'; type='page'; url='chrome-extension://fixture/autorun.html?run=1' },
        [pscustomobject]@{ id='status'; type='page'; url='chrome-extension://fixture/options.html' },
        [pscustomobject]@{ id='provider'; type='page'; url='https://fin.land.naver.com/map' },
        [pscustomobject]@{ id='idle'; type='page'; url='edge://newtab/' },
        [pscustomobject]@{ id='worker'; type='service_worker'; url='chrome-extension://fixture/background.js' }
      )
    }
    ${debugHelper}
    $pages = @(Get-EdgeAutoDebugPages)
    [pscustomobject]@{
      pageIds = @($pages | ForEach-Object { $_.id })
      triggerIds = @($pages | Where-Object { $_.url -eq 'chrome-extension://fixture/autorun.html?run=1' } | ForEach-Object { $_.id })
      statusIds = @($pages | Where-Object { $_.url -eq 'chrome-extension://fixture/options.html' } | ForEach-Object { $_.id })
      cleanupIds = @($pages | Where-Object { $_.url -like 'edge://newtab*' -or $_.url -like 'chrome-extension://fixture/autorun.html*' } | ForEach-Object { $_.id })
    } | ConvertTo-Json -Compress
  `);
  assert.deepEqual(result, {
    pageIds: ['first', 'status', 'provider', 'idle'], triggerIds: ['first'], statusIds: ['status'], cleanupIds: ['first', 'idle']
  });
  assert.doesNotMatch(launcher, /Invoke-RestMethod[^\r\n]*\/json\/list[^\r\n]*\|/);
  assert.equal((launcher.match(/Get-EdgeAutoDebugPages\s*(?:\||\))/g) || []).length, 4);
});

test('profile argument matching handles Edge escaped paths but excludes every different profile', { skip: process.platform !== 'win32' }, () => {
  const doubled = profile.replaceAll('\\', '\\\\');
  const cases = [
    [`msedge.exe --user-data-dir=${profile}`, true],
    [`msedge.exe --user-data-dir=${doubled} --type=renderer`, true],
    [`msedge.exe --user-data-dir="${profile}" --type=gpu-process`, true],
    [`msedge.exe --user-data-dir=\\"${doubled}\\" --type=utility`, true],
    [`msedge.exe "--user-data-dir=${profile}" --type=renderer`, true],
    [`msedge.exe "--user-data-dir=\\"${doubled}\\"" --type=renderer`, true],
    [`msedge.exe --user-data-dir=${profile.replaceAll('\\', '/')}/`, true],
    [`msedge.exe --user-data-dir=${profile.toLowerCase()}`, true],
    [`msedge.exe --user-data-dir=${profile}\\..\\profile`, true],
    [`msedge.exe --user-data-dir=${profile}-backup`, false],
    [`msedge.exe --user-data-dir=${profile}\\other`, false],
    ['msedge.exe --user-data-dir=C:\\Users\\ITP\\AppData\\Local\\Microsoft\\Edge\\User Data', false],
    [`msedge.exe "https://example.com/?path=${profile}"`, false],
    [`msedge.exe "https://example.com/?path= --user-data-dir=${profile}"`, false],
    [`msedge.exe --user-data-dir=${profile} --user-data-dir=C:\\Other`, false],
    ['msedge.exe --user-data-dir=profile', false],
    ['msedge.exe --user-data-dir=C:profile', false],
    ['', false]
  ];
  const rows = cases.map(([commandLine, expected]) => ({ commandLine, expected }));
  const results = powershell('$rows = ' + psLiteral(JSON.stringify(rows)) + ' | ConvertFrom-Json; @($rows | ForEach-Object { ' +
    '[bool](Test-EdgeAutoProfileCommandLine -CommandLine $_.commandLine -ProfilePath ' + psLiteral(profile) + ') }) | ConvertTo-Json -Compress');
  assert.deepEqual(results, rows.map(row => row.expected));
});

test('canonical matching supports quoted names with spaces and returns only owned Edge processes', { skip: process.platform !== 'win32' }, () => {
  const spaced = String.raw`C:\Users\ITP Office\AppData\Local\JSMap\EdgeAutoCollector\profile`;
  const processes = [
    { Name: 'msedge.exe', ProcessId: 1, CommandLine: `msedge.exe --user-data-dir=${profile}` },
    { Name: 'msedge.exe', ProcessId: 2, CommandLine: `msedge.exe --type=renderer --user-data-dir=\\"${profile.replaceAll('\\', '\\\\')}\\"` },
    { Name: 'msedge.exe', ProcessId: 3, CommandLine: `msedge.exe --user-data-dir=${profile}-backup` },
    { Name: 'msedge.exe', ProcessId: 4, CommandLine: 'msedge.exe --profile-directory=Default' },
    { Name: 'notepad.exe', ProcessId: 5, CommandLine: `notepad.exe --user-data-dir=${profile}` }
  ];
  const results = powershell('$rows = ' + psLiteral(JSON.stringify(processes)) + ' | ConvertFrom-Json; ' +
    '$owned = @(Get-EdgeAutoProfileProcesses -ProfilePath ' + psLiteral(profile) + ' -Processes $rows); ' +
    '$quoted = Test-EdgeAutoProfileCommandLine -ProfilePath ' + psLiteral(spaced) + ' -CommandLine ' + psLiteral(`msedge.exe --user-data-dir="${spaced}"`) + '; ' +
    '$whole = Test-EdgeAutoProfileCommandLine -ProfilePath ' + psLiteral(spaced) + ' -CommandLine ' + psLiteral(`msedge.exe "--user-data-dir=${spaced}"`) + '; ' +
    '@{ ids = @($owned.ProcessId); quoted = $quoted; whole = $whole } | ConvertTo-Json -Compress');
  assert.deepEqual(results.ids, [1, 2]);
  assert.equal(results.quoted, true);
  assert.equal(results.whole, true);
});
