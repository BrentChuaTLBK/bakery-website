// Keep unrelated client exports importable as new admin sections are added.
// Unmocked calls still fail closed instead of reaching a production service.
export function completeClientFixture(source, fixture) {
  const names = [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)].map(match => match[1]);
  return fixture + '\n' + names.filter(name => !new RegExp(`\\b${name}\\s*(?:\\(|=)`).test(fixture))
    .map(name => `export async function ${name}(){throw Error('Unmocked client call: ${name}');}`).join('\n');
}
