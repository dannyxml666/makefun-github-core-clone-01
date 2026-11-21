import http from 'node:http';
import { store } from './store.ts';
import { handleGitRoutes } from './git-routes.ts';

let requestIdCounter = 1;

export function createApp(): http.Server {
  const server = http.createServer(async (req, res) => {
    const requestId = String(requestIdCounter++);
    res.setHeader('X-GitHub-Request-Id', requestId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const method = req.method || 'GET';

    // Helper for JSON response
    const sendJson = (statusCode: number, data: any, extraHeaders?: Record<string, string>) => {
      res.statusCode = statusCode;
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          res.setHeader(k, v);
        }
      }
      if (statusCode === 204) {
        res.end();
      } else {
        res.end(JSON.stringify(data));
      }
    };

    const sendError = (statusCode: number, message: string) => {
      sendJson(statusCode, { message });
    };

    // Parse JSON body helper
    const parseBody = async (): Promise<any> => {
      return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });
        req.on('end', () => {
          if (!body) return resolve({});
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error('Malformed JSON'));
          }
        });
        req.on('error', err => reject(err));
      });
    };

    // Health check (no token required)
    if (pathname === '/healthz' && method === 'GET') {
      return sendJson(200, { ok: true });
    }

    // Clean seam check for future GraphQL / MCP
    if (pathname.startsWith('/api/graphql') || pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      return sendError(404, 'Not Found');
    }

    // Git smart HTTP routes (no token required; must run before the auth check)
    if (await handleGitRoutes(req, res, pathname, method, Object.fromEntries(urlObj.searchParams))) {
      return;
    }

    // Authentication check for all /api/v3 routes
    const authHeader = req.headers['authorization'];
    const expectedToken = process.env.MAKEFUN_SHOP_TOKEN;
    if (expectedToken) {
      if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.substring(7) !== expectedToken) {
        return sendError(401, 'Requires authentication');
      }
    }

    // Routes under /api/v3
    if (pathname === '/api/v3' || pathname === '/api/v3/') {
      if (method === 'GET') {
        return sendJson(
          200,
          {
            current_user_url: 'https://api.github.com/user',
            current_user_authorization_html_url: 'https://github.com/settings/connections/applications/{client_id}',
            authorizations_url: 'https://api.github.com/authorizations',
            code_search_url: 'https://api.github.com/search/code?q={query}{&page,per_page,sort,order}',
            commit_search_url: 'https://api.github.com/search/commits?q={query}{&page,per_page,sort,order}',
            emails_url: 'https://api.github.com/user/emails',
            emojis_url: 'https://api.github.com/emojis',
            events_url: 'https://api.github.com/events',
            feeds_url: 'https://api.github.com/feeds',
            followers_url: 'https://api.github.com/user/followers',
            following_url: 'https://api.github.com/user/following{/target}',
            gists_url: 'https://api.github.com/gists{/gist_id}',
            hub_url: 'https://api.github.com/hub',
            issue_search_url: 'https://api.github.com/search/issues?q={query}{&page,per_page,sort,order}',
            issues_url: 'https://api.github.com/issues',
            keys_url: 'https://api.github.com/user/keys',
            label_search_url: 'https://api.github.com/search/labels?q={query}&repository_id={repository_id}',
            notifications_url: 'https://api.github.com/notifications',
            organization_url: 'https://api.github.com/orgs/{org}',
            organization_repositories_url: 'https://api.github.com/orgs/{org}/repos',
            organization_teams_url: 'https://api.github.com/orgs/{org}/teams',
            public_gists_url: 'https://api.github.com/gists/public',
            rate_limit_url: 'https://api.github.com/rate_limit',
            repository_url: 'https://api.github.com/repos/{owner}/{repo}',
            repository_search_url: 'https://api.github.com/search/repositories?q={query}{&page,per_page,sort,order}',
            current_user_repositories_url: 'https://api.github.com/user/repos{?type,page,per_page,sort,direction}',
            starred_url: 'https://api.github.com/user/starred{/owner}{/repo}',
            starred_gists_url: 'https://api.github.com/gists/starred',
            topic_search_url: 'https://api.github.com/search/topics?q={query}{&page,per_page,sort,order}',
            user_url: 'https://api.github.com/users/{user}',
            user_organizations_url: 'https://api.github.com/user/orgs',
            user_repositories_url: 'https://api.github.com/users/{user}/repos{?type,page,per_page,sort,direction}',
            user_search_url: 'https://api.github.com/search/users?q={query}'
          },
          { 'X-OAuth-Scopes': 'repo, read:org' }
        );
      }
    }

    if (pathname === '/api/v3/meta') {
      if (method === 'GET') {
        return sendJson(200, {
          installed_version: '2.30.0',
          verifiable_password_authentication: true
        });
      }
    }

    if (pathname === '/api/v3/user') {
      if (method === 'GET') {
        return sendJson(200, store.getUser());
      }
    }

    if (pathname === '/api/v3/user/repos') {
      if (method === 'GET') {
        const repos = store.listRepos();
        return sendJson(200, repos);
      }
      if (method === 'POST') {
        let body: any;
        try {
          body = await parseBody();
        } catch {
          return sendError(400, 'Malformed JSON');
        }
        const name = body.name;
        if (!name) return sendError(422, 'Repository name missing');
        const description = body.description || null;
        const privateFlag = body.private || false;
        const repo = store.createRepo(store.getUser().login, name, description, privateFlag);
        if (!repo) return sendError(422, 'Repository already exists or invalid owner');
        return sendJson(201, repo);
      }
    }

    // Match /api/v3/repos/{owner}/{repo} and subpaths
    const repoMatch = pathname.match(/^\/api\/v3\/repos\/([^\/]+)\/([^\/]+)(?:\/(.*))?$/);
    if (repoMatch) {
      const owner = decodeURIComponent(repoMatch[1]);
      const repoName = decodeURIComponent(repoMatch[2]);
      const subpath = repoMatch[3] || '';

      const repo = store.getRepo(owner, repoName);
      if (!repo) {
        return sendError(404, 'Not Found');
      }

      // Subpath handling
      if (subpath === '') {
        if (method === 'GET') return sendJson(200, repo);
        if (method === 'PATCH') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            return sendError(400, 'Malformed JSON');
          }
          const updated = store.updateRepo(owner, repoName, body.description);
          return sendJson(200, updated);
        }
        if (method === 'DELETE') {
          store.deleteRepo(owner, repoName);
          return sendJson(204, null);
        }
      }

      if (subpath === 'branches') {
        if (method === 'GET') {
          return sendJson(200, store.listBranches(owner, repoName));
        }
      }

      if (subpath === 'git/refs') {
        if (method === 'POST') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            return sendError(400, 'Malformed JSON');
          }
          const ref = body.ref;
          const sha = body.sha;
          if (!ref || !sha) {
            return sendError(422, 'Ref and sha are required');
          }
          const result = store.createRef(owner, repoName, ref, sha);
          if ('error' in result) {
            return sendError(result.status, result.error);
          }
          return sendJson(201, result);
        }
      }

      const branchMatch = subpath.match(/^branches\/(.+)$/);
      if (branchMatch) {
        const branchName = decodeURIComponent(branchMatch[1]);
        if (method === 'GET') {
          const b = store.getBranch(owner, repoName, branchName);
          if (!b) return sendError(404, 'Branch not found');
          return sendJson(200, b);
        }
      }

      if (subpath === 'commits') {
        if (method === 'GET') {
          const branch = urlObj.searchParams.get('sha') || undefined;
          return sendJson(200, store.listCommits(owner, repoName, branch));
        }
      }

      const contentsMatch = subpath.match(/^contents\/(.+)$/);
      if (contentsMatch) {
        const filePath = decodeURIComponent(contentsMatch[1]);
        if (method === 'GET') {
          const content = store.getContent(owner, repoName, repo.default_branch, filePath);
          if (!content) return sendError(404, 'Path not found');
          return sendJson(200, content);
        }
        if (method === 'PUT') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            return sendError(400, 'Malformed JSON');
          }
          const resResult = store.putContent(
            owner,
            repoName,
            repo.default_branch,
            filePath,
            body.content,
            body.message || 'Update file',
            body.sha
          );
          if ('error' in resResult) {
            return sendError(resResult.status, resResult.error);
          }
          // Determine status: 201 for create, 200 for update (we can check if expectedSha or commit parent count)
          const status = body.sha ? 200 : 201;
          return sendJson(status, resResult);
        }
        if (method === 'DELETE') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            body = {};
          }
          const resResult = store.deleteContent(
            owner,
            repoName,
            repo.default_branch,
            filePath,
            body.message || 'Delete file'
          );
          if ('error' in resResult) {
            return sendError(resResult.status, resResult.error);
          }
          return sendJson(200, resResult);
        }
      }

      if (subpath === 'labels') {
        if (method === 'GET') {
          return sendJson(200, store.listLabels(owner, repoName));
        }
        if (method === 'POST') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            return sendError(400, 'Malformed JSON');
          }
          const label = store.createLabel(owner, repoName, body.name);
          if (!label) return sendError(422, 'Invalid label name');
          return sendJson(201, label);
        }
      }

      if (subpath === 'issues') {
        if (method === 'GET') {
          const state = urlObj.searchParams.get('state') || 'open';
          const sort = urlObj.searchParams.get('sort') || 'created';
          const direction = urlObj.searchParams.get('direction') || 'desc';
          const page = parseInt(urlObj.searchParams.get('page') || '1', 10);
          const perPage = parseInt(urlObj.searchParams.get('per_page') || '30', 10);

          const issues = store.listIssues(owner, repoName, { state, sort, direction, page, perPage });
          if (!issues) return sendError(404, 'Repository not found');
          return sendJson(200, issues);
        }
        if (method === 'POST') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            return sendError(400, 'Malformed JSON');
          }
          const issueRes = store.createIssue(owner, repoName, body.title, body.body, body.labels || []);
          if ('error' in issueRes) {
            return sendError(issueRes.status, issueRes.error);
          }
          return sendJson(201, issueRes);
        }
      }

      const issueNumMatch = subpath.match(/^issues\/(\d+)$/);
      if (issueNumMatch) {
        const num = parseInt(issueNumMatch[1], 10);
        if (method === 'GET') {
          const issue = store.getIssue(owner, repoName, num);
          if (!issue) return sendError(404, 'Issue not found');
          return sendJson(200, issue);
        }
        if (method === 'PATCH' || method === 'PUT') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            return sendError(400, 'Malformed JSON');
          }
          const res = store.updateIssue(owner, repoName, num, {
            state: body.state,
            title: body.title,
            body: body.body
          });
          if ('error' in res) {
            return sendError(res.status, res.error);
          }
          return sendJson(200, res);
        }
      }

      const issueCommentsMatch = subpath.match(/^issues\/(\d+)\/comments$/);
      if (issueCommentsMatch) {
        const num = parseInt(issueCommentsMatch[1], 10);
        if (method === 'GET') {
          const comments = store.listIssueComments(owner, repoName, num);
          if (!comments) return sendError(404, 'Issue not found');
          return sendJson(200, comments);
        }
        if (method === 'POST') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            return sendError(400, 'Malformed JSON');
          }
          const comm = store.createIssueComment(owner, repoName, num, body.body);
          if ('error' in comm) {
            return sendError(comm.status, comm.error);
          }
          return sendJson(201, comm);
        }
      }

      if (subpath === 'pulls') {
        if (method === 'GET') {
          return sendJson(200, store.listPulls(owner, repoName));
        }
        if (method === 'POST') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            return sendError(400, 'Malformed JSON');
          }
          const pullRes = store.createPull(owner, repoName, body.title, body.body, body.head, body.base);
          if ('error' in pullRes) {
            return sendError(pullRes.status, pullRes.error);
          }
          return sendJson(201, pullRes);
        }
      }

      const pullNumMatch = subpath.match(/^pulls\/(\d+)$/);
      if (pullNumMatch) {
        const num = parseInt(pullNumMatch[1], 10);
        if (method === 'GET') {
          const pull = store.getPull(owner, repoName, num);
          if (!pull) return sendError(404, 'Pull request not found');
          return sendJson(200, pull);
        }
      }

      const pullFilesMatch = subpath.match(/^pulls\/(\d+)\/files$/);
      if (pullFilesMatch) {
        const num = parseInt(pullFilesMatch[1], 10);
        if (method === 'GET') {
          const files = store.getPullFiles(owner, repoName, num);
          if (!files) return sendError(404, 'Pull request not found');
          return sendJson(200, files);
        }
      }

      const pullMergeMatch = subpath.match(/^pulls\/(\d+)\/merge$/);
      if (pullMergeMatch) {
        const num = parseInt(pullMergeMatch[1], 10);
        if (method === 'PUT') {
          let body: any;
          try {
            body = await parseBody();
          } catch {
            body = {};
          }
          const mergeRes = store.mergePull(owner, repoName, num, body.commit_message);
          if ('error' in mergeRes) {
            return sendError(mergeRes.status, mergeRes.error);
          }
          return sendJson(200, mergeRes);
        }
      }
    }

    // Default 404 for unknown routes
    return sendError(404, 'Not Found');
  });

  return server;
}
