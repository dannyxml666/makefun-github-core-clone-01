import crypto from 'node:crypto';

export interface User {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  html_url: string;
  type: string;
  site_admin: boolean;
  name: string;
  company: string | null;
  blog: string;
  location: string | null;
  email: string | null;
  hireable: boolean | null;
  bio: string | null;
  twitter_username: string | null;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
}

export interface Owner {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string | null;
  url: string;
  html_url: string;
  type: string;
  site_admin: boolean;
}

export interface Repository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  owner: Owner;
  html_url: string;
  description: string | null;
  fork: boolean;
  url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  default_branch: string;
  branches: Map<string, string>; // branch name -> commit SHA
  objects: Map<string, Uint8Array>; // object SHA -> object bytes
  issueCounter: number;
  issues: Map<number, Issue>;
  labels: Map<string, Label>;
  pullCounter: number;
  pulls: Map<number, PullRequest>;
}

export interface Branch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface CommitInfo {
  sha: string;
  node_id: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
    tree: {
      sha: string;
      url: string;
    };
    url: string;
    comment_count: number;
  };
  url: string;
  html_url: string;
  comments_url: string;
  author: Owner;
  committer: Owner;
  parents: Array<{ sha: string; url: string }>;
}

export interface ContentObject {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string | null;
  git_url: string | null;
  download_url: string | null;
  type: string;
  content?: string;
  encoding?: string;
}

export interface ContentCommitResponse {
  content: ContentObject | null;
  commit: {
    sha: string;
    node_id: string;
    url: string;
    html_url: string;
    author: { name: string; email: string; date: string };
    committer: { name: string; email: string; date: string };
    message: string;
    tree: { sha: string; url: string };
    parents: Array<{ sha: string; url: string }>;
  };
}

export interface Label {
  id: number;
  node_id: string;
  url: string;
  name: string;
  color: string;
  default: boolean;
  description: string | null;
}

export interface Issue {
  id: number;
  node_id: string;
  url: string;
  repository_url: string;
  labels_url: string;
  comments_url: string;
  events_url: string;
  html_url: string;
  number: number;
  state: string;
  title: string;
  body: string | null;
  user: Owner;
  labels: Label[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comments: number;
}

export interface IssueComment {
  id: number;
  node_id: string;
  url: string;
  html_url: string;
  body: string;
  user: Owner;
  created_at: string;
  updated_at: string;
}

export interface PullRequest {
  id: number;
  node_id: string;
  url: string;
  html_url: string;
  diff_url: string;
  patch_url: string;
  issue_url: string;
  number: number;
  state: string;
  locked: boolean;
  title: string;
  user: Owner;
  body: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: {
    label: string;
    ref: string;
    sha: string;
    user: Owner;
    repo: Repository | null;
  };
  base: {
    label: string;
    ref: string;
    sha: string;
    user: Owner;
    repo: Repository | null;
  };
  merged?: boolean;
  merge_message?: string;
}

export class GitForgeStore {
  private repos = new Map<string, Repository>(); // repoName -> Repository (owner is fixed user)
  private repoIdCounter = 1;
  private userId = 1000;
  private fixedLogin = 'adaiversen';

  constructor() {}

  getTrialNow(): string {
    return process.env.MAKEFUN_TRIAL_NOW || '2026-01-01T00:00:00Z';
  }

  getUser(): User {
    const now = this.getTrialNow();
    return {
      login: this.fixedLogin,
      id: this.userId,
      node_id: 'MDQ6VXNlcjEwMDA=',
      avatar_url: `https://avatars.githubusercontent.com/u/${this.userId}?v=4`,
      html_url: `https://github.com/${this.fixedLogin}`,
      type: 'User',
      site_admin: false,
      name: 'ada iversen',
      company: null,
      blog: '',
      location: null,
      email: 'adaiversen@example.invalid',
      hireable: null,
      bio: null,
      twitter_username: null,
      public_repos: this.repos.size,
      public_gists: 0,
      followers: 0,
      following: 0,
      created_at: now,
      updated_at: now
    };
  }

  getOwnerObject(): Owner {
    return {
      login: this.fixedLogin,
      id: this.userId,
      node_id: 'MDQ6VXNlcjEwMDA=',
      avatar_url: `https://avatars.githubusercontent.com/u/${this.userId}?v=4`,
      gravatar_id: '',
      url: `https://api.github.com/users/${this.fixedLogin}`,
      html_url: `https://github.com/${this.fixedLogin}`,
      type: 'User',
      site_admin: false
    };
  }

  listRepos(): Repository[] {
    const list: Repository[] = [];
    for (const repo of this.repos.values()) {
      list.push(repo);
    }
    return list;
  }

  getRepo(owner: string, repoName: string): Repository | undefined {
    if (owner.toLowerCase() !== this.fixedLogin.toLowerCase()) {
      return undefined;
    }
    return this.repos.get(repoName);
  }

  createRepo(owner: string, name: string, description: string | null, privateFlag: boolean): Repository | undefined {
    if (owner.toLowerCase() !== this.fixedLogin.toLowerCase()) {
      return undefined;
    }
    if (this.repos.has(name)) {
      return undefined; // or handle conflict
    }
    const id = this.repoIdCounter++;
    const now = this.getTrialNow();
    const ownerObj = this.getOwnerObject();
    const repo: Repository = {
      id,
      node_id: `R_kgDOH${id}`,
      name,
      full_name: `${this.fixedLogin}/${name}`,
      private: privateFlag ?? false,
      owner: ownerObj,
      html_url: `https://github.com/${this.fixedLogin}/${name}`,
      description: description ?? null,
      fork: false,
      url: `https://api.github.com/repos/${this.fixedLogin}/${name}`,
      created_at: now,
      updated_at: now,
      pushed_at: now,
      default_branch: 'main',
      branches: new Map<string, string>(),
      objects: new Map<string, Uint8Array>(),
      issueCounter: 0,
      issues: new Map<number, Issue>(),
      labels: new Map<string, Label>(),
      pullCounter: 0,
      pulls: new Map<number, PullRequest>()
    };

    // Initialize empty root commit on main branch so repository has a default branch and commit
    const emptyTreeSha = this.storeObject(repo, 'tree', new Uint8Array(0));
    const commitSha = this.createCommit(repo, emptyTreeSha, [], 'Initial commit');
    repo.branches.set('main', commitSha);

    this.repos.set(name, repo);
    return repo;
  }

  updateRepo(owner: string, repoName: string, description: string | null): Repository | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    if (description !== undefined) {
      repo.description = description;
      repo.updated_at = this.getTrialNow();
    }
    return repo;
  }

  deleteRepo(owner: string, repoName: string): boolean {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return false;
    return this.repos.delete(repoName);
  }

  storeObject(repo: Repository, type: string, content: Uint8Array): string {
    const header = Buffer.from(`${type} ${content.length}\0`);
    const full = Buffer.concat([header, content]);
    const sha = crypto.createHash('sha1').update(full).digest('hex');
    repo.objects.set(sha, full);
    return sha;
  }

  createCommit(repo: Repository, treeSha: string, parentShas: string[], message: string): string {
    const now = this.getTrialNow();
    // format date as epoch + timezone or standard git author line format
    const authorLine = `author ${this.fixedLogin} <user@example.com> 1700000000 +0000`;
    const committerLine = `committer ${this.fixedLogin} <user@example.com> 1700000000 +0000`;
    let commitContentStr = `tree ${treeSha}\n`;
    for (const p of parentShas) {
      commitContentStr += `parent ${p}\n`;
    }
    commitContentStr += `${authorLine}\n${committerLine}\n\n${message}\n`;
    const commitBytes = Buffer.from(commitContentStr, 'utf-8');
    return this.storeObject(repo, 'commit', commitBytes);
  }

  // Helper to parse tree object bytes or build tree objects
  // Git tree format: entries sorted by name (or binary sort). Each entry: mode SP path NUL 20-byte-sha
  parseTree(repo: Repository, treeSha: string): Map<string, { mode: string; sha: string; type: string }> {
    const entries = new Map<string, { mode: string; sha: string; type: string }>();
    const objBytes = repo.objects.get(treeSha);
    if (!objBytes) return entries;
    // skip header: find first null byte
    let idx = 0;
    while (idx < objBytes.length && objBytes[idx] !== 0) {
      idx++;
    }
    idx++; // skip null byte

    while (idx < objBytes.length) {
      // parse mode
      let spaceIdx = idx;
      while (spaceIdx < objBytes.length && objBytes[spaceIdx] !== 0x20) {
        spaceIdx++;
      }
      if (spaceIdx >= objBytes.length) break;
      const mode = Buffer.from(objBytes.subarray(idx, spaceIdx)).toString('utf-8');
      idx = spaceIdx + 1;

      // parse name until null byte
      let nullIdx = idx;
      while (nullIdx < objBytes.length && objBytes[nullIdx] !== 0) {
        nullIdx++;
      }
      if (nullIdx >= objBytes.length) break;
      const name = Buffer.from(objBytes.subarray(idx, nullIdx)).toString('utf-8');
      idx = nullIdx + 1;

      // parse 20-byte sha
      if (idx + 20 > objBytes.length) break;
      const shaBytes = objBytes.subarray(idx, idx + 20);
      const sha = Buffer.from(shaBytes).toString('hex');
      idx += 20;

      const type = mode === '40000' || mode === '040000' ? 'tree' : 'blob';
      entries.set(name, { mode, sha, type });
    }
    return entries;
  }

  buildTree(repo: Repository, entries: Map<string, { mode: string; sha: string; type: string }>): string {
    // Sort entries alphabetically by name (or git tree sort order)
    const sortedNames = Array.from(entries.keys()).sort((a, b) => {
      // Git tree sort: directories have implicit trailing slash
      const aName = entries.get(a)?.type === 'tree' ? a + '/' : a;
      const bName = entries.get(b)?.type === 'tree' ? b + '/' : b;
      return aName < bName ? -1 : aName > bName ? 1 : 0;
    });

    const parts: Uint8Array[] = [];
    for (const name of sortedNames) {
      const entry = entries.get(name)!;
      const modeBuf = Buffer.from(entry.mode + ' ');
      const nameBuf = Buffer.from(name + '\0');
      const shaHexBuf = Buffer.from(entry.sha, 'hex');
      parts.push(Buffer.concat([modeBuf, nameBuf, shaHexBuf]));
    }
    const content = Buffer.concat(parts);
    return this.storeObject(repo, 'tree', content);
  }

  getCommitTree(repo: Repository, commitSha: string): string {
    const obj = repo.objects.get(commitSha);
    if (!obj) return '';
    const text = Buffer.from(obj).toString('utf-8');
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('tree ')) {
        return line.substring(5).trim();
      }
    }
    return '';
  }

  getCommitParents(repo: Repository, commitSha: string): string[] {
    const obj = repo.objects.get(commitSha);
    if (!obj) return [];
    const text = Buffer.from(obj).toString('utf-8');
    const lines = text.split('\n');
    const parents: string[] = [];
    for (const line of lines) {
      if (line.startsWith('parent ')) {
        parents.push(line.substring(7).trim());
      }
    }
    return parents;
  }

  resolvePathInTree(repo: Repository, treeSha: string, segments: string[]): { sha: string; mode: string } | undefined {
    let currentSha = treeSha;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const entries = this.parseTree(repo, currentSha);
      const entry = entries.get(seg);
      if (!entry) return undefined;
      if (i === segments.length - 1) {
        return { sha: entry.sha, mode: entry.mode };
      }
      if (entry.type !== 'tree') return undefined;
      currentSha = entry.sha;
    }
    return undefined;
  }

  getContent(owner: string, repoName: string, branchName: string, filePath: string): ContentObject | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    const commitSha = repo.branches.get(branchName);
    if (!commitSha) return undefined;
    const treeSha = this.getCommitTree(repo, commitSha);
    if (!treeSha) return undefined;

    const segments = filePath.split('/').filter(Boolean);
    const resolved = this.resolvePathInTree(repo, treeSha, segments);
    if (!resolved) return undefined;

    const blobBytesFull = repo.objects.get(resolved.sha);
    if (!blobBytesFull) return undefined;

    // extract content after null byte in blob
    let idx = 0;
    while (idx < blobBytesFull.length && blobBytesFull[idx] !== 0) {
      idx++;
    }
    const contentBytes = blobBytesFull.subarray(idx + 1);
    const base64Content = Buffer.from(contentBytes).toString('base64');
    const fileName = segments[segments.length - 1] || '';

    return {
      name: fileName,
      path: filePath,
      sha: resolved.sha,
      size: contentBytes.length,
      url: `https://api.github.com/repos/${repo.full_name}/contents/${filePath}`,
      html_url: `https://github.com/${repo.full_name}/blob/${branchName}/${filePath}`,
      git_url: `https://api.github.com/repos/${repo.full_name}/git/blobs/${resolved.sha}`,
      download_url: `https://raw.githubusercontent.com/${repo.full_name}/${branchName}/${filePath}`,
      type: 'file',
      content: base64Content,
      encoding: 'base64'
    };
  }

  putContent(
    owner: string,
    repoName: string,
    branchName: string,
    filePath: string,
    contentBase64: string,
    message: string,
    expectedSha?: string
  ): ContentCommitResponse | { error: string; status: number } {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return { error: 'Repository not found', status: 404 };

    const headCommitSha = repo.branches.get(branchName) || repo.branches.get(repo.default_branch);
    let currentTreeSha = headCommitSha ? this.getCommitTree(repo, headCommitSha) : '';

    const segments = filePath.split('/').filter(Boolean);
    if (segments.length === 0) return { error: 'Invalid path', status: 400 };

    // Check expectedSha if provided (for update)
    if (expectedSha && headCommitSha) {
      const existing = this.resolvePathInTree(repo, currentTreeSha, segments);
      if (existing && existing.sha !== expectedSha) {
        return { error: 'Stale SHA', status: 409 };
      }
    }

    const fileContentBuf = Buffer.from(contentBase64, 'base64');
    const newBlobSha = this.storeObject(repo, 'blob', fileContentBuf);

    // Recursively build/update tree
    const newTreeSha = this.insertIntoTree(repo, currentTreeSha, segments, 0, newBlobSha, '100644');

    const parents = headCommitSha ? [headCommitSha] : [];
    const newCommitSha = this.createCommit(repo, newTreeSha, parents, message);
    repo.branches.set(branchName, newCommitSha);
    if (!repo.branches.has(repo.default_branch)) {
      repo.branches.set(repo.default_branch, newCommitSha);
    }
    repo.pushed_at = this.getTrialNow();

    const contentObj: ContentObject = {
      name: segments[segments.length - 1],
      path: filePath,
      sha: newBlobSha,
      size: fileContentBuf.length,
      url: `https://api.github.com/repos/${repo.full_name}/contents/${filePath}`,
      html_url: `https://github.com/${repo.full_name}/blob/${branchName}/${filePath}`,
      git_url: `https://api.github.com/repos/${repo.full_name}/git/blobs/${newBlobSha}`,
      download_url: `https://raw.githubusercontent.com/${repo.full_name}/${branchName}/${filePath}`,
      type: 'file'
    };

    return {
      content: contentObj,
      commit: {
        sha: newCommitSha,
        node_id: `C_kgDOH${newCommitSha.substring(0, 6)}`,
        url: `https://api.github.com/repos/${repo.full_name}/commits/${newCommitSha}`,
        html_url: `https://github.com/${repo.full_name}/commit/${newCommitSha}`,
        author: { name: this.fixedLogin, email: 'user@example.com', date: this.getTrialNow() },
        committer: { name: this.fixedLogin, email: 'user@example.com', date: this.getTrialNow() },
        message,
        tree: { sha: newTreeSha, url: `https://api.github.com/repos/${repo.full_name}/git/trees/${newTreeSha}` },
        parents: parents.map(p => ({ sha: p, url: `https://api.github.com/repos/${repo.full_name}/commits/${p}` }))
      }
    };
  }

  insertIntoTree(repo: Repository, treeSha: string, segments: string[], segIndex: number, blobSha: string, mode: string): string {
    const entries = treeSha ? this.parseTree(repo, treeSha) : new Map<string, { mode: string; sha: string; type: string }>();
    const seg = segments[segIndex];

    if (segIndex === segments.length - 1) {
      entries.set(seg, { mode, sha: blobSha, type: 'blob' });
    } else {
      const existing = entries.get(seg);
      const subTreeSha = existing && existing.type === 'tree' ? existing.sha : '';
      const newSubTreeSha = this.insertIntoTree(repo, subTreeSha, segments, segIndex + 1, blobSha, mode);
      entries.set(seg, { mode: '040000', sha: newSubTreeSha, type: 'tree' });
    }
    return this.buildTree(repo, entries);
  }

  deleteContent(owner: string, repoName: string, branchName: string, filePath: string, message: string): { commit: any } | { error: string; status: number } {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return { error: 'Repository not found', status: 404 };

    const headCommitSha = repo.branches.get(branchName) || repo.branches.get(repo.default_branch);
    if (!headCommitSha) return { error: 'Branch not found', status: 404 };
    const currentTreeSha = this.getCommitTree(repo, headCommitSha);

    const segments = filePath.split('/').filter(Boolean);
    if (segments.length === 0) return { error: 'Invalid path', status: 400 };

    const newTreeSha = this.removeFromTree(repo, currentTreeSha, segments, 0);
    if (!newTreeSha) return { error: 'Path not found', status: 404 };

    const parents = [headCommitSha];
    const newCommitSha = this.createCommit(repo, newTreeSha, parents, message);
    repo.branches.set(branchName, newCommitSha);
    repo.pushed_at = this.getTrialNow();

    return {
      commit: {
        sha: newCommitSha,
        node_id: `C_kgDOH${newCommitSha.substring(0, 6)}`,
        url: `https://api.github.com/repos/${repo.full_name}/commits/${newCommitSha}`,
        html_url: `https://github.com/${repo.full_name}/commit/${newCommitSha}`,
        author: { name: this.fixedLogin, email: 'user@example.com', date: this.getTrialNow() },
        committer: { name: this.fixedLogin, email: 'user@example.com', date: this.getTrialNow() },
        message,
        tree: { sha: newTreeSha, url: `https://api.github.com/repos/${repo.full_name}/git/trees/${newTreeSha}` },
        parents: parents.map(p => ({ sha: p, url: `https://api.github.com/repos/${repo.full_name}/commits/${p}` }))
      }
    };
  }

  removeFromTree(repo: Repository, treeSha: string, segments: string[], segIndex: number): string | undefined {
    const entries = this.parseTree(repo, treeSha);
    const seg = segments[segIndex];

    if (segIndex === segments.length - 1) {
      if (!entries.has(seg)) return undefined;
      entries.delete(seg);
    } else {
      const existing = entries.get(seg);
      if (!existing || existing.type !== 'tree') return undefined;
      const newSubTreeSha = this.removeFromTree(repo, existing.sha, segments, segIndex + 1);
      if (newSubTreeSha === undefined) return undefined;
      if (newSubTreeSha === '') {
        entries.delete(seg);
      } else {
        entries.set(seg, { mode: '040000', sha: newSubTreeSha, type: 'tree' });
      }
    }
    if (entries.size === 0) {
      return ''; // empty tree or can return empty tree sha
    }
    return this.buildTree(repo, entries);
  }

  listBranches(owner: string, repoName: string): Branch[] | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    const list: Branch[] = [];
    for (const [name, sha] of repo.branches.entries()) {
      list.push({
        name,
        commit: {
          sha,
          url: `https://api.github.com/repos/${repo.full_name}/commits/${sha}`
        },
        protected: false
      });
    }
    return list;
  }

  getBranch(owner: string, repoName: string, branchName: string): Branch | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    const sha = repo.branches.get(branchName);
    if (!sha) return undefined;
    return {
      name: branchName,
      commit: {
        sha,
        url: `https://api.github.com/repos/${repo.full_name}/commits/${sha}`
      },
      protected: false
    };
  }

  listCommits(owner: string, repoName: string, branchName?: string): CommitInfo[] | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    const targetBranch = branchName || repo.default_branch;
    const startSha = repo.branches.get(targetBranch);
    if (!startSha) return [];

    const commits: CommitInfo[] = [];
    const visited = new Set<string>();
    const queue = [startSha];

    while (queue.length > 0) {
      const sha = queue.shift()!;
      if (visited.has(sha)) continue;
      visited.add(sha);

      const treeSha = this.getCommitTree(repo, sha);
      const parents = this.getCommitParents(repo, sha);
      const now = this.getTrialNow();
      const ownerObj = this.getOwnerObject();

      commits.push({
        sha,
        node_id: `C_kgDOH${sha.substring(0, 6)}`,
        commit: {
          author: { name: this.fixedLogin, email: 'user@example.com', date: now },
          committer: { name: this.fixedLogin, email: 'user@example.com', date: now },
          message: 'Commit message', // can parse exact message if stored in commit object
          tree: { sha: treeSha, url: `https://api.github.com/repos/${repo.full_name}/git/trees/${treeSha}` },
          url: `https://api.github.com/repos/${repo.full_name}/commits/${sha}`,
          comment_count: 0
        },
        url: `https://api.github.com/repos/${repo.full_name}/commits/${sha}`,
        html_url: `https://github.com/${repo.full_name}/commit/${sha}`,
        comments_url: `https://api.github.com/repos/${repo.full_name}/commits/${sha}/comments`,
        author: ownerObj,
        committer: ownerObj,
        parents: parents.map(p => ({ sha: p, url: `https://api.github.com/repos/${repo.full_name}/commits/${p}` }))
      });

      for (const p of parents) {
        if (!visited.has(p)) queue.push(p);
      }
    }
    return commits;
  }

  // Labels
  listLabels(owner: string, repoName: string): Label[] | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    return Array.from(repo.labels.values());
  }

  createLabel(owner: string, repoName: string, name: string): Label | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    if (repo.labels.has(name)) {
      return repo.labels.get(name);
    }
    const label: Label = {
      id: repo.labels.size + 1,
      node_id: `LA_kgDOH${repo.labels.size + 1}`,
      url: `https://api.github.com/repos/${repo.full_name}/labels/${encodeURIComponent(name)}`,
      name,
      color: 'ededed',
      default: false,
      description: null
    };
    repo.labels.set(name, label);
    return label;
  }

  // Issues
  listIssues(owner: string, repoName: string): Issue[] | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    return Array.from(repo.issues.values());
  }

  createIssue(owner: string, repoName: string, title: string, body: string | null, labelNames: string[] = []): Issue | { error: string; status: number } {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return { error: 'Repository not found', status: 404 };

    const resolvedLabels: Label[] = [];
    for (const lName of labelNames) {
      const label = repo.labels.get(lName);
      if (!label) {
        return { error: `Label "${lName}" does not exist`, status: 422 };
      }
      resolvedLabels.push(label);
    }

    repo.issueCounter++;
    const number = repo.issueCounter;
    const now = this.getTrialNow();
    const ownerObj = this.getOwnerObject();

    const issue: Issue = {
      id: number,
      node_id: `I_kgDOH${number}`,
      url: `https://api.github.com/repos/${repo.full_name}/issues/${number}`,
      repository_url: repo.url,
      labels_url: `https://api.github.com/repos/${repo.full_name}/issues/${number}/labels{/name}`,
      comments_url: `https://api.github.com/repos/${repo.full_name}/issues/${number}/comments`,
      events_url: `https://api.github.com/repos/${repo.full_name}/issues/${number}/events`,
      html_url: `https://github.com/${repo.full_name}/issues/${number}`,
      number,
      state: 'open',
      title,
      body: body ?? null,
      user: ownerObj,
      labels: resolvedLabels,
      created_at: now,
      updated_at: now,
      closed_at: null,
      comments: 0
    };

    repo.issues.set(number, issue);
    return issue;
  }

  getIssue(owner: string, repoName: string, number: number): Issue | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    return repo.issues.get(number);
  }

  // Comments (stored per issue or generic)
  private issueComments = new Map<string, IssueComment[]>(); // `${owner}/${repo}/${number}` -> comments

  createIssueComment(owner: string, repoName: string, number: number, body: string): IssueComment | { error: string; status: number } {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return { error: 'Repository not found', status: 404 };
    const issue = repo.issues.get(number);
    if (!issue) return { error: 'Issue not found', status: 404 };

    const key = `${repo.full_name}/${number}`;
    let list = this.issueComments.get(key);
    if (!list) {
      list = [];
      this.issueComments.set(key, list);
    }

    const commentId = list.length + 1;
    const now = this.getTrialNow();
    const ownerObj = this.getOwnerObject();

    const comment: IssueComment = {
      id: commentId,
      node_id: `IC_kgDOH${commentId}`,
      url: `https://api.github.com/repos/${repo.full_name}/issues/comments/${commentId}`,
      html_url: `https://github.com/${repo.full_name}/issues/${number}#issuecomment-${commentId}`,
      body,
      user: ownerObj,
      created_at: now,
      updated_at: now
    };

    list.push(comment);
    issue.comments = list.length;
    return comment;
  }

  listIssueComments(owner: string, repoName: string, number: number): IssueComment[] | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    const issue = repo.issues.get(number);
    if (!issue) return undefined;
    const key = `${repo.full_name}/${number}`;
    return this.issueComments.get(key) || [];
  }

  // Pull Requests
  listPulls(owner: string, repoName: string): PullRequest[] | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    return Array.from(repo.pulls.values());
  }

  createPull(owner: string, repoName: string, title: string, body: string | null, head: string, base: string): PullRequest | { error: string; status: number } {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return { error: 'Repository not found', status: 404 };

    repo.pullCounter++;
    const number = repo.pullCounter;
    const now = this.getTrialNow();
    const ownerObj = this.getOwnerObject();
    const headSha = repo.branches.get(head) || head;
    const baseSha = repo.branches.get(base) || base;

    const pull: PullRequest = {
      id: number,
      node_id: `PR_kgDOH${number}`,
      url: `https://api.github.com/repos/${repo.full_name}/pulls/${number}`,
      html_url: `https://github.com/${repo.full_name}/pull/${number}`,
      diff_url: `https://github.com/${repo.full_name}/pull/${number}.diff`,
      patch_url: `https://github.com/${repo.full_name}/pull/${number}.patch`,
      issue_url: `https://api.github.com/repos/${repo.full_name}/issues/${number}`,
      number,
      state: 'open',
      locked: false,
      title,
      user: ownerObj,
      body: body ?? null,
      created_at: now,
      updated_at: now,
      closed_at: null,
      merged_at: null,
      merge_commit_sha: null,
      head: {
        label: `${this.fixedLogin}:${head}`,
        ref: head,
        sha: headSha,
        user: ownerObj,
        repo
      },
      base: {
        label: `${this.fixedLogin}:${base}`,
        ref: base,
        sha: baseSha,
        user: ownerObj,
        repo
      },
      merged: false
    };

    repo.pulls.set(number, pull);
    return pull;
  }

  getPull(owner: string, repoName: string, number: number): PullRequest | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    return repo.pulls.get(number);
  }

  getPullFiles(owner: string, repoName: string, number: number): Array<{ filename: string; status: string; additions: number; deletions: number; changes: number }> | undefined {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return undefined;
    const pull = repo.pulls.get(number);
    if (!pull) return undefined;

    // Compare base tree and head tree to list changed files
    const baseSha = repo.branches.get(pull.base.ref) || pull.base.sha;
    const headSha = repo.branches.get(pull.head.ref) || pull.head.sha;
    const baseTreeSha = this.getCommitTree(repo, baseSha);
    const headTreeSha = this.getCommitTree(repo, headSha);

    const baseEntries = this.parseTree(repo, baseTreeSha);
    const headEntries = this.parseTree(repo, headTreeSha);

    const files: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number }> = [];

    for (const [name, entry] of headEntries.entries()) {
      if (!baseEntries.has(name)) {
        files.push({ filename: name, status: 'added', additions: 1, deletions: 0, changes: 1 });
      } else if (baseEntries.get(name)?.sha !== entry.sha) {
        files.push({ filename: name, status: 'modified', additions: 1, deletions: 1, changes: 2 });
      }
    }
    for (const [name] of baseEntries.entries()) {
      if (!headEntries.has(name)) {
        files.push({ filename: name, status: 'removed', additions: 0, deletions: 1, changes: 1 });
      }
    }

    return files;
  }

  mergePull(owner: string, repoName: string, number: number, commitMessage?: string): { sha: string; merged: boolean; message: string } | { error: string; status: number } {
    const repo = this.getRepo(owner, repoName);
    if (!repo) return { error: 'Repository not found', status: 404 };
    const pull = repo.pulls.get(number);
    if (!pull) return { error: 'Pull request not found', status: 404 };
    if (pull.state !== 'open') return { error: 'Pull request already closed or merged', status: 405 };

    const headBranch = pull.head.ref;
    const baseBranch = pull.base.ref;
    const headSha = repo.branches.get(headBranch);
    const baseSha = repo.branches.get(baseBranch);

    if (!headSha || !baseSha) {
      return { error: 'Head or base branch does not exist', status: 405 };
    }

    // Check if head is ahead of base
    if (headSha === baseSha) {
      return { error: 'Head branch has no commits ahead of base', status: 405 };
    }

    const headTreeSha = this.getCommitTree(repo, headSha);
    const msg = commitMessage || `Merge pull request #${number} from ${this.fixedLogin}/${headBranch}`;

    // Create squash commit on base branch (e.g. main)
    const mergeCommitSha = this.createCommit(repo, headTreeSha, [baseSha], msg);
    repo.branches.set(baseBranch, mergeCommitSha);

    const now = this.getTrialNow();
    pull.state = 'closed';
    pull.merged = true;
    pull.merged_at = now;
    pull.closed_at = now;
    pull.merge_commit_sha = mergeCommitSha;
    pull.merge_message = msg;

    return {
      sha: mergeCommitSha,
      merged: true,
      message: 'Pull Request successfully merged'
    };
  }
}

export const store = new GitForgeStore();
