// Installation health only. Never copy request URLs, headers, addresses,
// account identifiers, contacts, memo text, user agents or IPs into this log.
export function publicReleaseObservationV241(request) {
  const url = new URL(request.url);
  if (request.method !== 'HEAD' || url.pathname !== '/public-release-v240.json') return null;
  const stage = url.searchParams.get('release_status_v241'), build = url.searchParams.get('build');
  const code = url.searchParams.get('code'), rawRepairs = url.searchParams.get('repairs');
  if (!['started', 'prepared', 'blocked'].includes(stage) || !/^[a-f0-9]{24}$/.test(build || '') ||
      !['ok', 'cache_repaired', 'manifest_invalid', 'shell_invalid', 'asset_invalid', 'timeout', 'install_failed'].includes(code) ||
      !/^\d{1,3}$/.test(rawRepairs || '') || Number(rawRepairs) > 512) return null;
  return {stage, build, code, repairs: Number(rawRepairs)};
}
