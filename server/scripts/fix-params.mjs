import fs from 'node:fs';

const helper = `
function param(req: { params: Record<string, unknown> }, key: string) {
  const value = req.params[key];
  const id = Array.isArray(value) ? value[0] : value;
  if (typeof id !== 'string' || !id) throw new AppError('BAD_REQUEST', 400, 'Identifikuesi mungon.');
  return id;
}
`;

for (const file of ['src/routes/workspace.ts', 'src/routes/platform.ts']) {
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace(/req\.params\.(\w+)/g, "param(req, '$1')");
  if (!source.includes('function param(')) source += helper;
  fs.writeFileSync(file, source);
}
