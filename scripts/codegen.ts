import { createFromRoot } from 'codama';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
const source = path.resolve('target/idl/attendback.json');
const idl = JSON.parse(readFileSync(source, 'utf8')) as AnchorIdl;
createFromRoot(rootNodeFromAnchor(idl)).accept(
  renderVisitor(path.resolve('packages/chain-client/src/generated'), {
    formatCode: true,
    generatedFolder: '',
    syncPackageJson: false,
    kitImportStrategy: 'rootOnly',
  }),
);
mkdirSync('idl', { recursive: true });
copyFileSync(source, 'idl/attendback.json');
