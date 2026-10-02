const fs = require('fs');
const path = require('path');

function parseScalar(raw) {
  const text = raw.trim();
  if (!text || text === '|' || text === '>') return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  return text;
}

/**
 * Indentation parser for the FitMunch info.properties map in project.yml.
 * Enough for maps, lists, quoted strings, and booleans. Not a general YAML loader.
 */
function parseInfoProperties(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => line === '      properties:');
  if (start < 0) {
    throw new Error('info.properties block not found');
  }
  const slice = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^ */)[0].length;
    if (indent < 8) break;
    slice.push(line);
  }
  return parseBlock(slice, 0, 8).value;
}

function parseBlock(lines, index, indent) {
  if (index >= lines.length) return { value: {}, index };
  const line = lines[index];
  const current = line.match(/^ */)[0].length;
  if (line.trim().startsWith('- ') && current >= indent) {
    const list = [];
    let cursor = index;
    while (cursor < lines.length) {
      const item = lines[cursor];
      const itemIndent = item.match(/^ */)[0].length;
      if (itemIndent < indent || !item.trim().startsWith('- ')) break;
      const rest = item.trim().slice(2);
      if (!rest) {
        const nested = parseBlock(lines, cursor + 1, itemIndent + 2);
        list.push(nested.value);
        cursor = nested.index;
      } else if (rest.includes(': ') || /:\s*$/.test(rest)) {
        const nestedLines = [ `${' '.repeat(itemIndent + 2)}${rest}`, ...[] ];
        // A dash item that is itself a map is not used in this plist. Keep the scalar.
        list.push(parseScalar(rest));
        cursor += 1;
        void nestedLines;
      } else {
        list.push(parseScalar(rest));
        cursor += 1;
      }
    }
    return { value: list, index: cursor };
  }

  const map = {};
  let cursor = index;
  while (cursor < lines.length) {
    const row = lines[cursor];
    const rowIndent = row.match(/^ */)[0].length;
    if (rowIndent < indent) break;
    if (rowIndent > indent) {
      throw new Error(`Unexpected indent in info.properties: ${row}`);
    }
    const trimmed = row.trim();
    const splitAt = trimmed.indexOf(':');
    if (splitAt < 0) throw new Error(`Expected key in info.properties: ${row}`);
    const key = trimmed.slice(0, splitAt).trim();
    const rest = trimmed.slice(splitAt + 1).trim();
    if (!rest) {
      const nested = parseBlock(lines, cursor + 1, indent + 2);
      map[key] = nested.value;
      cursor = nested.index;
    } else {
      map[key] = parseScalar(rest);
      cursor += 1;
    }
  }
  return { value: map, index: cursor };
}

function checkInfoProperties(properties) {
  const errors = [];
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return ['info.properties is missing'];
  }
  const launch = properties.UILaunchScreen;
  if (!launch || typeof launch !== 'object' || Array.isArray(launch)) {
    errors.push('UILaunchScreen is missing from info.properties');
  } else {
    if (!launch.UIColorName) errors.push('UILaunchScreen.UIColorName is missing');
    if (!launch.UIImageName) errors.push('UILaunchScreen.UIImageName is missing');
  }
  if (!Object.prototype.hasOwnProperty.call(properties, 'ITSAppUsesNonExemptEncryption')) {
    errors.push('ITSAppUsesNonExemptEncryption is missing from info.properties');
  }
  const key = properties.REVENUECAT_API_KEY;
  if (typeof key !== 'string' || key.trim() === '' || key.trim() === 'appl_xxx') {
    errors.push('REVENUECAT_API_KEY is missing, empty, or appl_xxx');
  }
  for (const name of Object.keys(properties)) {
    if (name.startsWith('NSHealth')) {
      errors.push(`NSHealth key present in info.properties: ${name}`);
    }
  }
  return errors;
}

function quotedPriceLiterals(source) {
  const hits = [];
  const strings = /"(?:\\.|[^"\\\n])*"/g;
  // $9.99 and "$0" count. Swift "$0.role" inside a dictionary literal does not.
  const price = /\$(?:0(?![.\w])|[1-9]\d*)(?:\.\d+)?/;
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const found = line.match(strings);
    if (!found) return;
    for (const literal of found) {
      if (price.test(literal)) hits.push(`${index + 1}:${line.trim()}`);
    }
  });
  return hits;
}

describe('XcodeGen info.properties launch screen and RevenueCat key', () => {
  const project = fs.readFileSync(path.join(__dirname, 'project.yml'), 'utf8');
  const properties = parseInfoProperties(project);

  it('keeps launch screen, export compliance, and a real RevenueCat key', () => {
    expect(checkInfoProperties(properties)).toEqual([]);
    expect(properties.UILaunchScreen).toEqual({
      UIColorName: 'LaunchBackground',
      UIImageName: 'LaunchLogo',
    });
    expect(properties.ITSAppUsesNonExemptEncryption).toBe(false);
    expect(properties.REVENUECAT_API_KEY.startsWith('appl_')).toBe(true);
    expect(properties.REVENUECAT_API_KEY).not.toBe('appl_xxx');
    expect(project).toMatch(/CURRENT_PROJECT_VERSION:\s*"10"/);
  });

  it('rejects a plist spec that drops the launch screen, the key, or adds Health', () => {
    expect(checkInfoProperties({})).toEqual(expect.arrayContaining([
      'UILaunchScreen is missing from info.properties',
      'ITSAppUsesNonExemptEncryption is missing from info.properties',
      'REVENUECAT_API_KEY is missing, empty, or appl_xxx',
    ]));
    expect(checkInfoProperties({
      UILaunchScreen: {},
      ITSAppUsesNonExemptEncryption: false,
      REVENUECAT_API_KEY: 'appl_xxx',
      NSHealthShareUsageDescription: 'unused',
    })).toEqual(expect.arrayContaining([
      'UILaunchScreen.UIColorName is missing',
      'UILaunchScreen.UIImageName is missing',
      'REVENUECAT_API_KEY is missing, empty, or appl_xxx',
      'NSHealth key present in info.properties: NSHealthShareUsageDescription',
    ]));
    expect(checkInfoProperties({
      UILaunchScreen: { UIColorName: 'LaunchBackground', UIImageName: 'LaunchLogo' },
      ITSAppUsesNonExemptEncryption: false,
      REVENUECAT_API_KEY: '',
    })).toEqual(['REVENUECAT_API_KEY is missing, empty, or appl_xxx']);
  });

  it('parses nested properties from a fixture the same way as project.yml', () => {
    const fixture = [
      '      properties:',
      '        UILaunchScreen:',
      '          UIColorName: LaunchBackground',
      '          UIImageName: LaunchLogo',
      '        ITSAppUsesNonExemptEncryption: false',
      '        REVENUECAT_API_KEY: appl_real',
      '        UISupportedInterfaceOrientations:',
      '          - UIInterfaceOrientationPortrait',
      '    settings:',
    ].join('\n');
    const parsed = parseInfoProperties(fixture);
    expect(checkInfoProperties(parsed)).toEqual([]);
    expect(parsed.UISupportedInterfaceOrientations).toEqual(['UIInterfaceOrientationPortrait']);
  });
});

describe('iOS views have no hard-coded price literals or web purchase door', () => {
  const root = path.join(__dirname, 'FitMunch');

  function swiftFiles(dir, acc = []) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) swiftFiles(full, acc);
      else if (name.endsWith('.swift')) acc.push(full);
    }
    return acc;
  }

  it('has no quoted dollar prices in Views and no web purchase path', () => {
    const views = swiftFiles(path.join(root, 'Views'));
    const hits = [];
    for (const file of views) {
      for (const hit of quotedPriceLiterals(fs.readFileSync(file, 'utf8'))) {
        hits.push(`${path.relative(root, file)}:${hit}`);
      }
    }
    expect(hits).toEqual([]);

    const target = swiftFiles(root).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(target).not.toContain('Continue on the web');
    expect(target).not.toContain('premiumWebURL');
    expect(target).not.toContain('openWebPremium');
    expect(target).not.toContain('Configuration Required');
    expect(target).not.toContain('fitmunch.com.au/login');
    expect(target).not.toContain('NSHealthShareUsageDescription');
    expect(target).not.toContain('NSHealthUpdateUsageDescription');
  });
});
