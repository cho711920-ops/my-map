// Keep the first URL in the existing thumbnail field. Each following URL is
// stored as a shared-prefix length and suffix, not a second full URL array.
export function packPhotoPaths(values) {
  const images = [...new Set((Array.isArray(values) ? values : []).map(value => String(value ?? "").trim())
    .filter(value => value && !/[\r\n]/.test(value) && !/\/origin\/profile\/|\/avatars\/|[?&]service=karrotauth(?:&|$)/i.test(value)))];
  if (!images.length) return null;
  const first = images[0];
  const lines = images.slice(1).map(url => {
    let prefix = 0;
    while (prefix < first.length && prefix < url.length && first[prefix] === url[prefix]) prefix++;
    return prefix + " " + url.slice(prefix);
  });
  return {thumbnail: first, photoCount: images.length, photoPathsV119: "v1\n" + lines.join("\n")};
}
