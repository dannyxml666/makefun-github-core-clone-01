import http from 'node:http';
import { encodePktLine, readPktLines, computeObjectIdentifier, buildPack, parsePack, wrapSideBand64k } from './git-protocol.ts';
import { store } from './store.ts';

const tagMaps = new Map<string, Map<string, string>>();

function getTagMap(owner: string, repoName: string): Map<string, string> {
  const key = `${owner}/${repoName}`;
  let m = tagMaps.get(key);
  if (!m) {
    m = new Map<string, string>();
    tagMaps.set(key, m);
  }
  return m;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function parseTagTarget(repo: any, sha: string): string | null {
  if (!repo || !repo.objects) return null;
  const objBuf = repo.objects.get(sha);
  if (!objBuf) return null;
  const nullIdx = objBuf.indexOf(0);
  if (nullIdx === -1) return null;
  const header = objBuf.subarray(0, nullIdx).toString('utf8');
  const type = header.split(' ')[0];
  if (type !== 'tag') return null;
  const content = objBuf.subarray(nullIdx + 1).toString('utf8');
  for (const line of content.split('\n')) {
    if (line.startsWith('object ')) {
      return line.substring(7).trim();
    }
  }
  return null;
}

function getCommitParentsLocal(repo: any, sha: string): string[] {
  if (!repo || !repo.objects) return [];
  const objBuf = repo.objects.get(sha);
  if (!objBuf) return [];
  const nullIdx = objBuf.indexOf(0);
  if (nullIdx === -1) return [];
  const content = objBuf.subarray(nullIdx + 1).toString('utf8');
  const parents: string[] = [];
  for (const line of content.split('\n')) {
    if (line.startsWith('parent ')) {
      parents.push(line.substring(7).trim());
    }
  }
  return parents;
}

function collectFetchObjects(repo: any, wants: string[], haves: string[], shallowBoundaries: string[], depth?: number) {
  const held = new Set<string>();
  const shallowBoundSet = new Set(shallowBoundaries);

  function addClosure(sha: string, followParents: boolean) {
    if (!sha || held.has(sha)) return;
    const objBuf = repo.objects.get(sha);
    if (!objBuf) return;
    held.add(sha);

    const nullIdx = objBuf.indexOf(0);
    if (nullIdx === -1) return;
    const header = objBuf.subarray(0, nullIdx).toString('utf8');
    const [type] = header.split(' ');
    const content = objBuf.subarray(nullIdx + 1);

    if (type === 'commit') {
      const text = content.toString('utf8');
      let treeSha = '';
      const parents: string[] = [];
      for (const line of text.split('\n')) {
        if (line.startsWith('tree ')) treeSha = line.substring(5).trim();
        else if (line.startsWith('parent ')) parents.push(line.substring(7).trim());
      }
      if (treeSha) addTreeClosure(treeSha);
      if (followParents) {
        for (const p of parents) addClosure(p, true);
      }
    } else if (type === 'tag') {
      const targetSha = parseTagTarget(repo, sha);
      if (targetSha) addClosure(targetSha, followParents);
    } else if (type === 'tree') {
      addTreeClosureContent(content);
    }
  }

  function addTreeClosure(treeSha: string) {
    if (!treeSha || held.has(treeSha)) return;
    const objBuf = repo.objects.get(treeSha);
    if (!objBuf) return;
    held.add(treeSha);
    const nullIdx = objBuf.indexOf(0);
    if (nullIdx === -1) return;
    addTreeClosureContent(objBuf.subarray(nullIdx + 1));
  }

  function addTreeClosureContent(contentBuf: Buffer) {
    let offset = 0;
    while (offset < contentBuf.length) {
      const spaceIdx = contentBuf.indexOf(32, offset);
      if (spaceIdx === -1) break;
      const nullIdx = contentBuf.indexOf(0, spaceIdx);
      if (nullIdx === -1) break;
      const entryShaBuf = contentBuf.subarray(nullIdx + 1, nullIdx + 21);
      if (entryShaBuf.length < 20) break;
      const entrySha = entryShaBuf.toString('hex');
      offset = nullIdx + 21;
      addClosure(entrySha, true);
    }
  }

  for (const h of haves) {
    const isShallowBound = shallowBoundSet.has(h);
    addClosure(h, !isShallowBound);
  }

  const queue: { sha: string; d: number }[] = wants.map(sha => ({ sha, d: 0 }));
  const visitedAtDepth = new Map<string, number>();
  const includedObjects = new Set<string>();
  const newShallowBoundaries = new Set<string>();

  while (queue.length > 0) {
    const { sha, d } = queue.shift()!;
    if (!sha) continue;
    const existingD = visitedAtDepth.get(sha);
    if (existingD !== undefined && existingD <= d) continue;
    visitedAtDepth.set(sha, d);

    const objBuf = repo.objects.get(sha);
    if (!objBuf) continue;

    const nullIdx = objBuf.indexOf(0);
    if (nullIdx === -1) continue;
    const header = objBuf.subarray(0, nullIdx).toString('utf8');
    const [type] = header.split(' ');
    const content = objBuf.subarray(nullIdx + 1);

    if (type === 'tag') {
      includedObjects.add(sha);
      const targetSha = parseTagTarget(repo, sha);
      if (targetSha) {
        queue.push({ sha: targetSha, d });
      }
      continue;
    }

    if (type === 'commit') {
      const hasDepthLimit = depth !== undefined && depth > 0;
      const isTooDeep = hasDepthLimit && d >= depth;

      if (isTooDeep) {
        newShallowBoundaries.add(sha);
        continue;
      }

      includedObjects.add(sha);

      const text = content.toString('utf8');
      let treeSha = '';
      const parents: string[] = [];
      for (const line of text.split('\n')) {
        if (line.startsWith('tree ')) treeSha = line.substring(5).trim();
        else if (line.startsWith('parent ')) parents.push(line.substring(7).trim());
      }

      if (treeSha) {
        addTreeIncluded(treeSha, includedObjects);
      }

      for (const p of parents) {
        queue.push({ sha: p, d: d + 1 });
      }
    } else if (type === 'tree') {
      includedObjects.add(sha);
      addTreeIncludedContent(content, includedObjects);
    } else {
      includedObjects.add(sha);
    }
  }

  function addTreeIncluded(treeSha: string, set: Set<string>) {
    if (!treeSha || set.has(treeSha)) return;
    const objBuf = repo.objects.get(treeSha);
    if (!objBuf) return;
    set.add(treeSha);
    const nullIdx = objBuf.indexOf(0);
    if (nullIdx === -1) return;
    addTreeIncludedContent(objBuf.subarray(nullIdx + 1), set);
  }

  function addTreeIncludedContent(contentBuf: Buffer, set: Set<string>) {
    let offset = 0;
    while (offset < contentBuf.length) {
      const spaceIdx = contentBuf.indexOf(32, offset);
      if (spaceIdx === -1) break;
      const nullIdx = contentBuf.indexOf(0, spaceIdx);
      if (nullIdx === -1) break;
      const entryShaBuf = contentBuf.subarray(nullIdx + 1, nullIdx + 21);
      if (entryShaBuf.length < 20) break;
      const entrySha = entryShaBuf.toString('hex');
      offset = nullIdx + 21;
      addBlobOrTreeIncluded(entrySha, set);
    }
  }

  function addBlobOrTreeIncluded(sha: string, set: Set<string>) {
    if (!sha || set.has(sha)) return;
    const objBuf = repo.objects.get(sha);
    if (!objBuf) return;
    set.add(sha);
    const nullIdx = objBuf.indexOf(0);
    if (nullIdx === -1) return;
    const header = objBuf.subarray(0, nullIdx).toString('utf8');
    const [type] = header.split(' ');
    if (type === 'tree') {
      addTreeIncludedContent(objBuf.subarray(nullIdx + 1), set);
    }
  }

  const packObjects: { type: string; content: Buffer }[] = [];
  for (const sha of includedObjects) {
    if (held.has(sha)) continue;
    const objBuf = repo.objects.get(sha);
    if (!objBuf) continue;
    const nullIdx = objBuf.indexOf(0);
    if (nullIdx === -1) continue;
    const header = objBuf.subarray(0, nullIdx).toString('utf8');
    const [type] = header.split(' ');
    const content = objBuf.subarray(nullIdx + 1);
    packObjects.push({ type, content });
  }

  const shallowList: string[] = [];
  if (depth !== undefined && depth > 0) {
    for (const sha of includedObjects) {
      const parents = getCommitParentsLocal(repo, sha);
      if (parents.length > 0) {
        const d = visitedAtDepth.get(sha);
        if (d === depth - 1) {
          shallowList.push(sha);
        }
      }
    }
  }
  for (const sb of newShallowBoundaries) {
    if (!shallowList.includes(sb)) shallowList.push(sb);
  }

  const unshallowList: string[] = [];
  for (const sb of shallowBoundaries) {
    if (includedObjects.has(sb)) {
      const parents = getCommitParentsLocal(repo, sb);
      const allParentsIncluded = parents.every(p => includedObjects.has(p) || held.has(p));
      if (parents.length === 0 || allParentsIncluded) {
        unshallowList.push(sb);
      }
    }
  }

  return { packObjects, shallow: shallowList, unshallow: unshallowList };
}

function isAncestor(repo: any, ancestorSha: string, descendantSha: string): boolean {
  if (ancestorSha === descendantSha) return true;
  const visited = new Set<string>();
  const queue = [descendantSha];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === ancestorSha) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const parents = getCommitParentsLocal(repo, current);
    for (const p of parents) {
      if (!visited.has(p)) {
        queue.push(p);
      }
    }
  }
  return false;
}

function storeObject(repo: any, type: string, content: Buffer): string {
  const sha = computeObjectIdentifier(type, content);
  const header = Buffer.from(`${type} ${content.length}\0`);
  const fullBuf = Buffer.concat([header, content]);
  if (!repo.objects) repo.objects = new Map();
  repo.objects.set(sha, fullBuf);
  return sha;
}

export async function handleGitRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  method: string,
  queryParams: Record<string, string>
): Promise<boolean> {
  try {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length < 3) return false;

    const owner = parts[0];
    const repoName = parts[1].replace(/\.git$/, '');
    const action = parts.slice(2).join('/');

    const validActions = ['info/refs', 'git-upload-pack', 'git-receive-pack'];
    if (!validActions.includes(action)) return false;

    const repo = store.getRepo(owner, repoName);

    if (action === 'info/refs' && method === 'GET') {
      const service = queryParams.service;
      if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Missing or invalid service query parameter' }));
        return true;
      }
      if (!repo) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Repository not found' }));
        return true;
      }

      const defaultBranch = repo.default_branch || 'main';
      const headSha = repo.branches && repo.branches.get(defaultBranch) || '0000000000000000000000000000000000000000';
      const tagMap = getTagMap(owner, repoName);

      if (service === 'git-receive-pack') {
        res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-advertisement' });
        res.write(encodePktLine('# service=git-receive-pack\n'));
        res.write('0000');
        const cap = 'report-status side-band-64k delete-refs';
        res.write(encodePktLine(`${headSha} HEAD\0${cap}\n`));
        if (repo.branches) {
          for (const [branch, sha] of repo.branches.entries()) {
            res.write(encodePktLine(`${sha} refs/heads/${branch}\n`));
          }
        }
        for (const [tag, sha] of tagMap.entries()) {
          res.write(encodePktLine(`${sha} refs/tags/${tag}\n`));
        }
        res.write('0000');
        res.end();
        return true;
      } else {
        const gitProtocol = req.headers['git-protocol'];
        if (gitProtocol === 'version=2') {
          res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' });
          res.write(encodePktLine('# service=git-upload-pack\n'));
          res.write('0000');
          res.write(encodePktLine('version 2\n'));
          res.write(encodePktLine('ls-refs=unborn\n'));
          res.write(encodePktLine('fetch=shallow wait-for-done\n'));
          res.write(encodePktLine('object-format=sha1\n'));
          res.write('0000');
          res.end();
          return true;
        } else {
          res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' });
          res.write(encodePktLine('# service=git-upload-pack\n'));
          res.write('0000');
          const cap = 'symref=HEAD:refs/heads/' + defaultBranch + ' side-band-64k thin-pack ofs-delta multi_ack shallow';
          res.write(encodePktLine(`${headSha} HEAD\0${cap}\n`));
          if (repo.branches) {
            for (const [branch, sha] of repo.branches.entries()) {
              res.write(encodePktLine(`${sha} refs/heads/${branch}\n`));
            }
          }
          for (const [tag, sha] of tagMap.entries()) {
            res.write(encodePktLine(`${sha} refs/tags/${tag}\n`));
          }
          res.write('0000');
          res.end();
          return true;
        }
      }
    }

    if (!repo) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Repository not found' }));
      return true;
    }

    if (action === 'git-upload-pack' && method === 'POST') {
      const body = await readBody(req);
      let pktLines: string[];
      try {
        pktLines = readPktLines(body).payloads;
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Malformed packet lines' }));
        return true;
      }

      const payloads = pktLines.map(p => p.toString().trim()).filter(p => p !== '0001' && p !== '0002' && p !== '');
      if (payloads.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Empty upload-pack request' }));
        return true;
      }

      const firstLine = payloads[0];

      // Version 2 ls-refs
      if (firstLine === 'command=ls-refs') {
        let peel = false;
        let symrefs = false;
        let unborn = false;
        const prefixes: string[] = [];
        for (let i = 1; i < payloads.length; i++) {
          const line = payloads[i];
          if (line === 'peel') peel = true;
          else if (line === 'symrefs') symrefs = true;
          else if (line === 'unborn') unborn = true;
          else if (line.startsWith('ref-prefix ')) {
            prefixes.push(line.substring(11).trim());
          }
        }

        const defaultBranch = repo.default_branch || 'main';
        const headSha = repo.branches && repo.branches.get(defaultBranch);
        const tagMap = getTagMap(owner, repoName);

        res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-result' });

        const matchesPrefix = (refName: string) => {
          if (prefixes.length === 0) return true;
          return prefixes.some(p => refName.startsWith(p));
        };

        // HEAD
        if (headSha) {
          if (matchesPrefix('HEAD')) {
            let line = `${headSha} HEAD`;
            if (symrefs) line += ` symref-target:refs/heads/${defaultBranch}`;
            res.write(encodePktLine(line + '\n'));
          }
        } else if (unborn) {
          if (matchesPrefix('HEAD')) {
            let line = `unborn HEAD`;
            if (symrefs) line += ` symref-target:refs/heads/${defaultBranch}`;
            res.write(encodePktLine(line + '\n'));
          }
        }

        if (repo.branches) {
          for (const [branch, sha] of repo.branches.entries()) {
            const refName = `refs/heads/${branch}`;
            if (matchesPrefix(refName)) {
              res.write(encodePktLine(`${sha} ${refName}\n`));
            }
          }
        }

        for (const [tag, sha] of tagMap.entries()) {
          const refName = `refs/tags/${tag}`;
          if (matchesPrefix(refName)) {
            let line = `${sha} ${refName}`;
            if (peel) {
              const target = parseTagTarget(repo, sha);
              if (target) line += ` peeled:${target}`;
            }
            res.write(encodePktLine(line + '\n'));
          }
        }

        res.write('0000');
        res.end();
        return true;
      }

      // Version 2 fetch
      if (firstLine === 'command=fetch') {
        const wants: string[] = [];
        const haves: string[] = [];
        const shallowBoundaries: string[] = [];
        let depth: number | undefined = undefined;

        for (let i = 1; i < payloads.length; i++) {
          const line = payloads[i];
          if (line.startsWith('want ')) {
            wants.push(line.substring(5).trim().split(' ')[0]);
          } else if (line.startsWith('have ')) {
            haves.push(line.substring(5).trim());
          } else if (line.startsWith('shallow ')) {
            shallowBoundaries.push(line.substring(8).trim());
          } else if (line.startsWith('deepen ')) {
            const dNum = parseInt(line.substring(7).trim(), 10);
            if (!isNaN(dNum)) depth = dNum;
          }
        }

        const { packObjects, shallow, unshallow } = collectFetchObjects(repo, wants, haves, shallowBoundaries, depth);

        res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-result' });
        res.write(encodePktLine('acknowledgments\n'));

        let acknowledgedAny = false;
        for (const h of haves) {
          if (repo.objects.has(h)) {
            acknowledgedAny = true;
            res.write(encodePktLine(`ACK ${h}\n`));
          }
        }
        if (!acknowledgedAny) {
          res.write(encodePktLine('NAK\n'));
        }

        res.write('0001'); // delimiter

        if (depth !== undefined || shallow.length > 0 || unshallow.length > 0) {
          res.write(encodePktLine('shallow-info\n'));
          for (const s of shallow) {
            res.write(encodePktLine(`shallow ${s}\n`));
          }
          for (const u of unshallow) {
            res.write(encodePktLine(`unshallow ${u}\n`));
          }
          res.write('0001'); // delimiter
        }

        res.write(encodePktLine('packfile\n'));
        const packBuf = buildPack(packObjects);
        const framed = wrapSideBand64k(packBuf);
        res.write(framed);
        res.end();
        return true;
      }

      // Version 0 fetch
      if (firstLine.startsWith('want ')) {
        const wants: string[] = [];
        const haves: string[] = [];
        const shallowBoundaries: string[] = [];
        let depth: number | undefined = undefined;
        let sideBand = false;

        for (let i = 0; i < payloads.length; i++) {
          const line = payloads[i];
          if (line.startsWith('want ')) {
            const parts = line.substring(5).trim().split(' ');
            wants.push(parts[0]);
            if (parts.includes('side-band-64k')) sideBand = true;
          } else if (line.startsWith('have ')) {
            haves.push(line.substring(5).trim());
          } else if (line.startsWith('shallow ')) {
            shallowBoundaries.push(line.substring(8).trim());
          } else if (line.startsWith('deepen ')) {
            const dNum = parseInt(line.substring(7).trim(), 10);
            if (!isNaN(dNum)) depth = dNum;
          }
        }

        const { packObjects, shallow, unshallow } = collectFetchObjects(repo, wants, haves, shallowBoundaries, depth);

        res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-result' });

        for (const s of shallow) {
          res.write(encodePktLine(`shallow ${s}\n`));
        }
        for (const u of unshallow) {
          res.write(encodePktLine(`unshallow ${u}\n`));
        }

        let acknowledgedAny = false;
        for (const h of haves) {
          if (repo.objects.has(h)) {
            acknowledgedAny = true;
            res.write(encodePktLine(`ACK ${h}\n`));
          }
        }
        if (!acknowledgedAny) {
          res.write(encodePktLine('NAK\n'));
        }

        const packBuf = buildPack(packObjects);
        if (sideBand) {
          res.write(wrapSideBand64k(packBuf));
        } else {
          res.write(packBuf);
        }
        res.end();
        return true;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unknown upload-pack command' }));
      return true;
    }

    if (action === 'git-receive-pack' && method === 'POST') {
      const body = await readBody(req);

      let flushIdx = -1;
      let offset = 0;
      while (offset + 4 <= body.length) {
        const lenHex = body.subarray(offset, offset + 4).toString('utf8');
        if (lenHex === '0000') {
          flushIdx = offset;
          break;
        }
        const len = parseInt(lenHex, 16);
        if (isNaN(len) || len < 4 || offset + len > body.length) {
          break;
        }
        if (len === 0) {
          flushIdx = offset;
          break;
        }
        offset += len;
      }

      if (flushIdx === -1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Malformed receive-pack request: flush packet not found' }));
        return true;
      }

      const refsPart = body.subarray(0, flushIdx);
      const packPart = body.subarray(flushIdx + 4);

      let refPayloads: string[] = [];
      try {
        refPayloads = readPktLines(refsPart).payloads.map(p => p.toString().trim()).filter(Boolean);
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result' });
        const errBuf = Buffer.concat([encodePktLine('unpack ng malformed refs\n'), Buffer.from('0000')]);
        if (refsPart.toString('utf8').includes('side-band-64k')) {
          res.write(wrapSideBand64k(errBuf));
        } else {
          res.write(errBuf);
        }
        res.end();
        return true;
      }

      let sideBand = false;
      const refUpdates: { oldSha: string; newSha: string; ref: string }[] = [];

      for (let i = 0; i < refPayloads.length; i++) {
        let line = refPayloads[i];
        const zeroIdx = line.indexOf('\0');
        if (zeroIdx !== -1) {
          const caps = line.substring(zeroIdx + 1);
          if (caps.includes('side-band-64k')) sideBand = true;
          line = line.substring(0, zeroIdx);
        }
        const parts = line.split(' ');
        if (parts.length >= 3) {
          refUpdates.push({
            oldSha: parts[0],
            newSha: parts[1],
            ref: parts[2]
          });
        }
      }

      let unpackOk = true;
      let unpackReason = '';
      if (packPart.length > 0) {
        try {
          const unpackedObjects = parsePack(packPart);
          for (const obj of unpackedObjects) {
            storeObject(repo, obj.type, obj.content);
          }
        } catch (err: any) {
          unpackOk = false;
          unpackReason = err?.message || 'invalid pack';
        }
      }

      const results: { ref: string; ok: boolean; reason?: string }[] = [];

      if (!unpackOk) {
        const reportLines: string[] = [];
        reportLines.push(encodePktLine(`unpack ng ${unpackReason}\n`));
        for (const u of refUpdates) {
          reportLines.push(encodePktLine(`ng ${u.ref} unpack failed\n`));
        }
        reportLines.push('0000');
        res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result' });
        const reportBuf = Buffer.concat(reportLines.map(l => typeof l === 'string' ? Buffer.from(l) : l));
        if (sideBand) {
          res.write(wrapSideBand64k(reportBuf));
        } else {
          res.write(reportBuf);
        }
        res.end();
        return true;
      }

      const tagMap = getTagMap(owner, repoName);

      for (const u of refUpdates) {
        const { oldSha, newSha, ref } = u;
        const zeroSha = '0000000000000000000000000000000000000000';

        if (ref.startsWith('refs/heads/')) {
          const branchName = ref.substring(11);
          if (newSha === zeroSha) {
            if (repo.branches && repo.branches.has(branchName)) {
              repo.branches.delete(branchName);
              results.push({ ref, ok: true });
            } else {
              results.push({ ref, ok: false, reason: 'ref does not exist' });
            }
          } else if (oldSha === zeroSha) {
            if (!repo.branches) repo.branches = new Map();
            repo.branches.set(branchName, newSha);
            results.push({ ref, ok: true });
          } else {
            if (!repo.branches) repo.branches = new Map();
            const currentSha = repo.branches.get(branchName) || zeroSha;
            if (currentSha !== oldSha) {
              results.push({ ref, ok: false, reason: 'non-fast-forward' });
            } else if (!isAncestor(repo, oldSha, newSha)) {
              results.push({ ref, ok: false, reason: 'non-fast-forward' });
            } else {
              repo.branches.set(branchName, newSha);
              results.push({ ref, ok: true });
            }
          }
        } else if (ref.startsWith('refs/tags/')) {
          const tagName = ref.substring(10);
          if (newSha === zeroSha) {
            if (tagMap.has(tagName)) {
              tagMap.delete(tagName);
              results.push({ ref, ok: true });
            } else {
              results.push({ ref, ok: false, reason: 'ref does not exist' });
            }
          } else if (oldSha === zeroSha) {
            tagMap.set(tagName, newSha);
            results.push({ ref, ok: true });
          } else {
            const currentSha = tagMap.get(tagName) || zeroSha;
            if (currentSha !== oldSha) {
              results.push({ ref, ok: false, reason: 'non-fast-forward' });
            } else {
              tagMap.set(tagName, newSha);
              results.push({ ref, ok: true });
            }
          }
        } else {
          results.push({ ref, ok: false, reason: 'ref format not supported' });
        }
      }

      const reportLines: string[] = [];
      reportLines.push(encodePktLine('unpack ok\n'));
      for (const r of results) {
        if (r.ok) {
          reportLines.push(encodePktLine(`ok ${r.ref}\n`));
        } else {
          reportLines.push(encodePktLine(`ng ${r.ref} ${r.reason}\n`));
        }
      }
      reportLines.push('0000');

      res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result' });
      const reportBuf = Buffer.concat(reportLines.map(l => typeof l === 'string' ? Buffer.from(l) : l));
      if (sideBand) {
        res.write(wrapSideBand64k(reportBuf));
      } else {
        res.write(reportBuf);
      }
      res.end();
      return true;
    }

    return false;
  } catch (err: any) {
    if (!res.headersSent) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: err?.message || 'Git protocol error' }));
    } else {
      res.end();
    }
    return true;
  }
}
