#!/usr/bin/env bun

/**
 * Collect recent merged PR review feedback for the unresolved-review sweep.
 *
 * The script intentionally avoids npm dependencies. It shells out to `gh`,
 * parses JSON in-process, and writes one deterministic report for the skill.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type ReviewKind = "code-review" | "security-review" | "unclassified";
type ReviewSource = "issue-comment" | "pull-review";

interface CliOptions {
  days: number;
  repo: string | null;
  output: string;
}

interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  mergedAt: string | null;
  headRefName: string;
  baseRefName: string;
  author: string | null;
}

interface ReviewEntry {
  id: string;
  source: ReviewSource;
  kind: ReviewKind;
  author: string;
  createdAt: string;
  body: string;
  url: string | null;
  path: string | null;
  line: number | null;
  state: string | null;
  statusGuess: "passed" | "has-findings" | "unknown";
}

interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

interface ThreadComment {
  author: string;
  createdAt: string;
  body: string;
  url: string | null;
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  startLine: number | null;
  comments: ThreadComment[];
}

interface CommentPage {
  comments: ThreadComment[];
  hasNextPage: boolean;
  endCursor: string | null;
}

interface PullRequestReport extends PullRequestSummary {
  collectionError: string | null;
  changedFiles: ChangedFile[];
  latestCodeReview: ReviewEntry | null;
  latestSecurityReview: ReviewEntry | null;
  classifiedReviewEntrySummaries: Array<{
    id: string;
    source: ReviewSource;
    kind: ReviewKind;
    author: string;
    createdAt: string;
    url: string | null;
    statusGuess: string;
    bodyPreview: string;
  }>;
  unresolvedInlineThreads: ReviewThread[];
}

const DEFAULT_OUTPUT = ".context/address-unresolved-pr-reviews/review-feedback.json";
const REVIEW_BOT_LOGINS = new Set(["claude[bot]"]);

function usage() {
  console.log(`Usage:
  bun .agents/skills/address-unresolved-pr-reviews/scripts/collect-review-feedback.ts [options]

Options:
  --days <N>       Look back N days from now. Defaults to REVIEW_LOOKBACK_DAYS or 7.
  --repo <repo>    GitHub repo in owner/name form. Defaults to gh's current repo.
  --output <path>  JSON output path. Defaults to ${DEFAULT_OUTPUT}.
  -h, --help       Show this help.
`);
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const envDays = process.env.REVIEW_LOOKBACK_DAYS;
  const options: CliOptions = {
    days: envDays ? parsePositiveInteger(envDays, "REVIEW_LOOKBACK_DAYS") : 7,
    repo: process.env.REVIEW_REPO ?? null,
    output: DEFAULT_OUTPUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--days") {
      index += 1;
      const value = argv[index];
      if (!value) throw new Error("--days requires a value");
      options.days = parsePositiveInteger(value, "--days");
      continue;
    }
    if (arg === "--repo") {
      index += 1;
      const value = argv[index];
      if (!value) throw new Error("--repo requires a value");
      options.repo = value;
      continue;
    }
    if (arg === "--output") {
      index += 1;
      const value = argv[index];
      if (!value) throw new Error("--output requires a value");
      options.output = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function runGh(args: string[]) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 50,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const command = ["gh", ...args].join(" ");
    const message = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${command} failed: ${message}`);
  }
  return result.stdout.trim();
}

function parseJson(text: string): unknown {
  if (text.length === 0) return null;
  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function flattenPages(value: unknown) {
  if (!Array.isArray(value)) return [];
  const flattened: unknown[] = [];
  for (const page of value) {
    if (Array.isArray(page)) {
      flattened.push(...page);
    } else {
      flattened.push(page);
    }
  }
  return flattened;
}

function getRepo(optionsRepo: string | null) {
  const repo =
    optionsRepo ?? runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Repository must be in owner/name form, got ${repo}`);
  }
  return { owner, name, fullName: `${owner}/${name}` };
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function lookbackSince(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { iso: since.toISOString(), searchDate: toDateOnly(since) };
}

function parsePrSummary(value: unknown): PullRequestSummary {
  if (!isRecord(value)) throw new Error("Unexpected PR summary shape");
  const author = isRecord(value.author) ? asNullableString(value.author.login) : null;
  return {
    number: asNumber(value.number),
    title: asString(value.title),
    url: asString(value.url),
    createdAt: asString(value.createdAt),
    mergedAt: asNullableString(value.mergedAt),
    headRefName: asString(value.headRefName),
    baseRefName: asString(value.baseRefName),
    author,
  };
}

function listRecentMergedPrs(repo: string, searchDate: string) {
  const raw = runGh([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "merged",
    "--search",
    `base:main merged:>=${searchDate}`,
    "--limit",
    "1000",
    "--json",
    "number,title,url,createdAt,mergedAt,headRefName,baseRefName,author",
  ]);
  const value = parseJson(raw);
  if (!Array.isArray(value)) throw new Error("Expected gh pr list to return an array");
  return value.map(parsePrSummary);
}

function restPaginated(owner: string, repo: string, path: string) {
  const raw = runGh(["api", "--paginate", "--slurp", `repos/${owner}/${repo}/${path}`]);
  return flattenPages(parseJson(raw));
}

function classifyReviewBody(body: string): ReviewKind {
  const text = body.trim();
  const isSecurityReview =
    /(^|\n)#{1,4}\s*Security Review\b/i.test(text) ||
    /^Security Review\b/i.test(text) ||
    /\bPassed security review\b/i.test(text);
  if (isSecurityReview) return "security-review";

  const isCodeReview =
    /^\*\*Claude finished\b/i.test(text) || /(^|\n)#{1,4}\s*Code Review\b/i.test(text);
  if (isCodeReview) return "code-review";

  return "unclassified";
}

function statusGuess(body: string, kind: ReviewKind): ReviewEntry["statusGuess"] {
  if (kind === "security-review") {
    if (
      /\bpassed security review\b/i.test(body) ||
      /\bresult:\s*passed\b/i.test(body) ||
      /\bno high-confidence security vulnerabilities found\b/i.test(body) ||
      /\bno (high|medium|exploitable|security) (severity )?(findings|vulnerabilities)\b/i.test(body)
    ) {
      return "passed";
    }
    if (/\b(high|medium)\b/i.test(body) || /\bfinding\b/i.test(body)) return "has-findings";
  }

  if (kind === "code-review") {
    if (/\ball (prior|outstanding) issues .* resolved\b/i.test(body)) return "passed";
    if (/\b(nit|bug|issue|risk|finding|suggest|missing|incorrect)\b/i.test(body)) {
      return "has-findings";
    }
  }

  return "unknown";
}

function bodyPreview(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function parseIssueComment(value: unknown): ReviewEntry | null {
  if (!isRecord(value)) return null;
  const user = isRecord(value.user) ? asString(value.user.login) : "";
  if (!REVIEW_BOT_LOGINS.has(user)) return null;

  const body = asString(value.body);
  const kind = classifyReviewBody(body);
  if (kind === "unclassified") return null;

  return {
    id: String(asNumber(value.id)),
    source: "issue-comment",
    kind,
    author: user,
    createdAt: asString(value.created_at),
    body,
    url: asNullableString(value.html_url),
    path: null,
    line: null,
    state: null,
    statusGuess: statusGuess(body, kind),
  };
}

function parsePullReview(value: unknown): ReviewEntry | null {
  if (!isRecord(value)) return null;
  const user = isRecord(value.user) ? asString(value.user.login) : "";
  if (!REVIEW_BOT_LOGINS.has(user)) return null;

  const body = asString(value.body);
  const kind = classifyReviewBody(body);
  if (kind === "unclassified") return null;

  return {
    id: String(asNumber(value.id)),
    source: "pull-review",
    kind,
    author: user,
    createdAt: asString(value.submitted_at),
    body,
    url: asNullableString(value.html_url),
    path: null,
    line: null,
    state: asNullableString(value.state),
    statusGuess: statusGuess(body, kind),
  };
}

function parseChangedFile(value: unknown): ChangedFile | null {
  if (!isRecord(value)) return null;
  return {
    filename: asString(value.filename),
    status: asString(value.status),
    additions: asNumber(value.additions),
    deletions: asNumber(value.deletions),
    changes: asNumber(value.changes),
  };
}

function latestOfKind(entries: ReviewEntry[], kind: ReviewKind) {
  const matching = entries.filter((entry) => entry.kind === kind);
  matching.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return matching[0] ?? null;
}

const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          comments(first: 100) {
            nodes {
              author {
                login
              }
              body
              createdAt
              url
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`;

const REVIEW_THREAD_COMMENTS_QUERY = `
query($threadId: ID!, $cursor: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $cursor) {
        nodes {
          author {
            login
          }
          body
          createdAt
          url
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`;

function parseCommentPage(commentsConnection: unknown): CommentPage {
  if (!isRecord(commentsConnection)) {
    return { comments: [], hasNextPage: false, endCursor: null };
  }

  const nodes = Array.isArray(commentsConnection.nodes) ? commentsConnection.nodes : [];
  const comments: ThreadComment[] = [];
  for (const comment of nodes) {
    if (!isRecord(comment)) continue;
    const author = isRecord(comment.author) ? asString(comment.author.login) : "";
    comments.push({
      author,
      createdAt: asString(comment.createdAt),
      body: asString(comment.body),
      url: asNullableString(comment.url),
    });
  }

  const pageInfo = isRecord(commentsConnection.pageInfo) ? commentsConnection.pageInfo : {};
  return {
    comments,
    hasNextPage: asBoolean(pageInfo.hasNextPage),
    endCursor: asNullableString(pageInfo.endCursor),
  };
}

function fetchRemainingThreadComments(threadId: string, initialCursor: string | null) {
  const comments: ThreadComment[] = [];
  let cursor = initialCursor;

  while (cursor) {
    const raw = runGh([
      "api",
      "graphql",
      "-f",
      `threadId=${threadId}`,
      "-f",
      `cursor=${cursor}`,
      "-f",
      `query=${REVIEW_THREAD_COMMENTS_QUERY}`,
    ]);
    const value = parseJson(raw);
    if (!isRecord(value)) break;
    const data = isRecord(value.data) ? value.data : {};
    const node = isRecord(data.node) ? data.node : {};
    const page = parseCommentPage(node.comments);
    comments.push(...page.comments);
    if (!page.hasNextPage) break;
    cursor = page.endCursor;
  }

  return comments;
}

function graphQlReviewThreads(owner: string, repo: string, number: number) {
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;

  while (true) {
    const args = [
      "api",
      "graphql",
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-F",
      `number=${number}`,
      "-f",
      `query=${REVIEW_THREADS_QUERY}`,
    ];
    if (cursor) {
      args.push("-f", `cursor=${cursor}`);
    }

    const raw = runGh(args);
    const value = parseJson(raw);
    if (!isRecord(value)) break;
    const data = isRecord(value.data) ? value.data : {};
    const repository = isRecord(data.repository) ? data.repository : {};
    const pullRequest = isRecord(repository.pullRequest) ? repository.pullRequest : {};
    const reviewThreads = isRecord(pullRequest.reviewThreads) ? pullRequest.reviewThreads : {};
    const nodes = Array.isArray(reviewThreads.nodes) ? reviewThreads.nodes : [];

    for (const node of nodes) {
      if (!isRecord(node)) continue;
      const threadId = asString(node.id);
      const firstCommentPage = parseCommentPage(node.comments);
      const parsedComments = [
        ...firstCommentPage.comments,
        ...fetchRemainingThreadComments(
          threadId,
          firstCommentPage.hasNextPage ? firstCommentPage.endCursor : null,
        ),
      ];

      threads.push({
        id: threadId,
        isResolved: asBoolean(node.isResolved),
        isOutdated: asBoolean(node.isOutdated),
        path: asNullableString(node.path),
        line: asNullableNumber(node.line),
        startLine: asNullableNumber(node.startLine),
        comments: parsedComments,
      });
    }

    const pageInfo = isRecord(reviewThreads.pageInfo) ? reviewThreads.pageInfo : {};
    if (!asBoolean(pageInfo.hasNextPage)) break;
    cursor = asNullableString(pageInfo.endCursor);
    if (!cursor) break;
  }

  return threads;
}

function collectForPr(owner: string, repo: string, pr: PullRequestSummary): PullRequestReport {
  const issueComments = restPaginated(owner, repo, `issues/${pr.number}/comments`)
    .map(parseIssueComment)
    .filter((entry): entry is ReviewEntry => entry !== null);

  const pullReviews = restPaginated(owner, repo, `pulls/${pr.number}/reviews`)
    .map(parsePullReview)
    .filter((entry): entry is ReviewEntry => entry !== null);

  const changedFiles = restPaginated(owner, repo, `pulls/${pr.number}/files`)
    .map(parseChangedFile)
    .filter((file): file is ChangedFile => file !== null);

  const reviewEntries = [...issueComments, ...pullReviews].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );

  const unresolvedInlineThreads = graphQlReviewThreads(owner, repo, pr.number).filter((thread) => {
    if (thread.isResolved) return false;
    return thread.comments.some((comment) => REVIEW_BOT_LOGINS.has(comment.author));
  });

  return {
    ...pr,
    collectionError: null,
    changedFiles,
    latestCodeReview: latestOfKind(reviewEntries, "code-review"),
    latestSecurityReview: latestOfKind(reviewEntries, "security-review"),
    classifiedReviewEntrySummaries: reviewEntries.map((entry) => ({
      id: entry.id,
      source: entry.source,
      kind: entry.kind,
      author: entry.author,
      createdAt: entry.createdAt,
      url: entry.url,
      statusGuess: entry.statusGuess,
      bodyPreview: bodyPreview(entry.body),
    })),
    unresolvedInlineThreads,
  };
}

function failedPrReport(pr: PullRequestSummary, error: unknown): PullRequestReport {
  return {
    ...pr,
    collectionError: errorMessage(error),
    changedFiles: [],
    latestCodeReview: null,
    latestSecurityReview: null,
    classifiedReviewEntrySummaries: [],
    unresolvedInlineThreads: [],
  };
}

function collectPullRequests(owner: string, repo: string, prs: PullRequestSummary[]) {
  const reports: PullRequestReport[] = [];

  for (const pr of prs) {
    try {
      reports.push(collectForPr(owner, repo, pr));
    } catch (error) {
      console.error(
        `Failed to collect review feedback for PR #${pr.number}: ${errorMessage(error)}`,
      );
      reports.push(failedPrReport(pr, error));
    }
  }

  return reports;
}

function main() {
  const options = parseArgs(Bun.argv.slice(2));
  const repo = getRepo(options.repo);
  const lookback = lookbackSince(options.days);
  const sinceMs = Date.parse(lookback.iso);
  const prs = listRecentMergedPrs(repo.fullName, lookback.searchDate).filter(
    (pr) => Date.parse(pr.mergedAt ?? "") >= sinceMs,
  );
  const pullRequests = collectPullRequests(repo.owner, repo.name, prs);

  const report = {
    generatedAt: new Date().toISOString(),
    repo,
    lookback: {
      days: options.days,
      since: lookback.iso,
      mergedSearchDate: lookback.searchDate,
    },
    totals: {
      pullRequests: pullRequests.length,
      withCodeReview: pullRequests.filter((pr) => pr.latestCodeReview !== null).length,
      withSecurityReview: pullRequests.filter((pr) => pr.latestSecurityReview !== null).length,
      collectionFailures: pullRequests.filter((pr) => pr.collectionError !== null).length,
      unresolvedInlineThreads: pullRequests.reduce(
        (total, pr) => total + pr.unresolvedInlineThreads.length,
        0,
      ),
    },
    pullRequests,
  };

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `Wrote ${pullRequests.length} PR review report(s) to ${options.output} ` +
      `(${report.totals.withCodeReview} code review, ` +
      `${report.totals.withSecurityReview} security review, ` +
      `${report.totals.collectionFailures} collection failure(s), ` +
      `${report.totals.unresolvedInlineThreads} unresolved inline thread(s))`,
  );
}

main();
