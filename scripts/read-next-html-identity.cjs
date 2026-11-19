// Input comes from the bounded loopback homepage response in handoff-probe.
const {readFileSync} = require('node:fs');
const {isAbsolute, join} = require('node:path');
const modules = process.argv[2];
if (typeof modules !== 'string' || !isAbsolute(modules)) process.exit(1);
const {parse, html} = require(join(modules, 'parse5/dist/index.js'));

// The operator reads inert HTML and decodes the Next 15 inline Flight records as data.
function postgresBuildId(body) {
  const stack = [parse(body)];
  const chunks = [], backends = [];
  while (stack.length) {
    const node = stack.pop();
    if (node.namespaceURI && node.namespaceURI !== html.NS.HTML) continue;
    if (node.tagName === 'meta' && node.parentNode.tagName === 'head') {
      const attrs = new Map(node.attrs.map(({name,value}) => [name,value]));
      if (attrs.get('name') === 'blizhniy-auth-backend') backends.push(attrs.get('content'));
    }
    if (node.tagName === 'script') {
      const attrs = new Map(node.attrs.map(({name,value}) => [name,value]));
      const type = (attrs.get('type') ?? '').trim().toLowerCase();
      if (attrs.has('src') || attrs.has('nomodule') || !['','text/javascript','application/javascript'].includes(type)) continue;
      const text = node.childNodes.map(child => child.value).join('');
      const chunk = /^self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\);?$/.exec(text);
      if (chunk) chunks.push(JSON.parse(chunk[1]));
      continue;
    }
    const children = node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  if (backends.length !== 1 || backends[0] !== 'postgres') return null;
  const records = chunks.join('').split('\n').filter(line => line.startsWith('0:'));
  return records.length === 1 ? JSON.parse(records[0].slice(2)).b : null;
}

try {
  const id = postgresBuildId(readFileSync(0, 'utf8'));
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) process.exitCode = 1;
  else process.stdout.write(id);
} catch {
  process.exitCode = 1;
}
