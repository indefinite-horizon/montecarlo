/** Protects the trust boundaries in GitHub Actions workflows. */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowsDirectory = resolve(import.meta.dirname, "../.github/workflows");
const workflows = readdirSync(workflowsDirectory)
  .filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"))
  .sort()
  .map((fileName) => {
    const path = resolve(workflowsDirectory, fileName);
    return { fileName, source: readFileSync(path, "utf8") };
  });

const sameRepositoryPullRequestGuard =
  "github.event.pull_request.head.repo.full_name == github.repository";
const sameRepositoryCiCondition = `github.event_name != 'pull_request' || ${sameRepositoryPullRequestGuard}`;
const trustedReviewCondition = `${sameRepositoryPullRequestGuard} && github.event.pull_request.user.login != 'dependabot[bot]'`;
const desktopReleaseSecretNames = [
  "DESKTOP_APPLE_API_ISSUER",
  "DESKTOP_APPLE_API_KEY_ID",
  "DESKTOP_APPLE_API_KEY_P8_BASE64",
  "DESKTOP_CSC_KEY_PASSWORD",
  "DESKTOP_CSC_LINK",
];

function normalizeExpression(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

function workflowJobs(source: string) {
  const lines = source.split("\n");
  const jobsStart = lines.indexOf("jobs:");
  if (jobsStart === -1) {
    throw new Error("Expected workflow jobs");
  }
  const jobs = new Map<string, string>();
  let jobName: string | undefined;
  let jobLines: string[] = [];

  const saveJob = () => {
    if (jobName) {
      jobs.set(jobName, jobLines.join("\n"));
    }
  };

  for (const line of lines.slice(jobsStart + 1)) {
    const jobMatch = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
    if (jobMatch) {
      saveJob();
      jobName = jobMatch[1];
      jobLines = [];
      continue;
    }
    if (jobName) {
      jobLines.push(line);
    }
  }
  saveJob();

  return jobs;
}

function jobCondition(job: string) {
  const lines = job.split("\n");
  const conditionStart = lines.findIndex((line) => /^ {4}if:/.test(line));
  if (conditionStart === -1) {
    throw new Error("Expected a job condition");
  }

  const inlineCondition = lines[conditionStart].replace(/^ {4}if:\s*/, "").trim();
  if (!/^[>|]-?$/.test(inlineCondition)) {
    return inlineCondition;
  }

  const conditionLines: string[] = [];
  for (const line of lines.slice(conditionStart + 1)) {
    if (line.trim() !== "" && !line.startsWith("      ")) {
      break;
    }
    conditionLines.push(line);
  }
  return conditionLines.join("\n");
}

describe("GitHub workflow security", () => {
  it("pins every remote action to a full commit SHA", () => {
    const remoteActions = workflows.flatMap(({ fileName, source }) =>
      source.split("\n").flatMap((line, lineIndex) => {
        const match = line.match(/^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?(?:\s+#.*)?$/);
        if (!match || match[1].startsWith("./")) {
          return [];
        }
        return [{ location: `${fileName}:${lineIndex + 1}`, action: match[1] }];
      }),
    );
    const unpinnedActions = remoteActions.filter(
      ({ action }) => !/^[^/@\s]+\/[^@\s]+@[0-9a-f]{40}$/i.test(action),
    );

    expect(remoteActions.length).toBeGreaterThan(0);
    expect(unpinnedActions).toEqual([]);
  });

  it("does not run CI jobs for pull requests from forks", () => {
    const ciWorkflow = workflows.find(({ fileName }) => fileName === "ci.yml");
    expect(ciWorkflow).toBeDefined();

    const unsafeJobs = [...workflowJobs(ciWorkflow?.source ?? "")]
      .filter(([, job]) => {
        const condition = normalizeExpression(jobCondition(job));
        const sameRepositoryOnly = condition === sameRepositoryCiCondition;
        const pushOnly = condition === "github.event_name == 'push'";
        return !sameRepositoryOnly && !pushOnly;
      })
      .map(([jobName]) => jobName);

    expect(unsafeJobs).toEqual([]);
  });

  it.each([
    "code-review.yml",
    "security-review.yml",
  ])("does not run %s jobs for pull requests from forks", (fileName) => {
    const workflow = workflows.find((candidate) => candidate.fileName === fileName);
    expect(workflow).toBeDefined();

    const unsafeJobs = [...workflowJobs(workflow?.source ?? "")]
      .filter(([, job]) => normalizeExpression(jobCondition(job)) !== trustedReviewCondition)
      .map(([jobName]) => jobName);

    expect(unsafeJobs).toEqual([]);
  });

  it("only lets trusted repository relationships trigger Claude", () => {
    const claudeWorkflow = workflows.find(({ fileName }) => fileName === "claude.yml");
    expect(claudeWorkflow).toBeDefined();
    const claudeJob = workflowJobs(claudeWorkflow?.source ?? "").get("claude");
    expect(claudeJob).toBeDefined();

    const actualCondition = normalizeExpression(jobCondition(claudeJob ?? ""));
    const expectedCondition = normalizeExpression(`
      (github.event_name == 'issue_comment' &&
       contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association) &&
       contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' &&
       contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association) &&
       contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review' &&
       contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.review.author_association) &&
       contains(github.event.review.body, '@claude')) ||
      (github.event_name == 'issues' &&
       contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.issue.author_association) &&
       (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))
    `);

    expect(actualCondition).toBe(expectedCondition);
  });

  it("confines Apple credentials to the protected desktop release environment", () => {
    const desktopRelease = workflows.find(({ fileName }) => fileName === "desktop-release.yml");
    expect(desktopRelease).toBeDefined();

    const releaseJob = workflowJobs(desktopRelease?.source ?? "").get("release-macos");
    expect(releaseJob).toBeDefined();
    expect(releaseJob).toMatch(/^ {4}environment: desktop-release$/m);

    const secretReferences = workflows.flatMap(({ fileName, source }) =>
      [...source.matchAll(/secrets\.(DESKTOP_[A-Z0-9_]+)/g)].map((match) => ({
        fileName,
        secretName: match[1],
      })),
    );

    expect([...new Set(secretReferences.map(({ secretName }) => secretName))].sort()).toEqual(
      desktopReleaseSecretNames,
    );
    expect([...new Set(secretReferences.map(({ fileName }) => fileName))]).toEqual([
      "desktop-release.yml",
    ]);
    expect(releaseJob).toContain(
      `printf '%s' "$CSC_LINK_P12_BASE64" | base64 -D > "$certificate_path"`,
    );
    expect(releaseJob).toContain("DESKTOP_APPLE_API_ISSUER must be a UUID");
    expect(releaseJob).toContain("xcrun notarytool history");
    expect(releaseJob).toContain(
      `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist"`,
    );
    expect(releaseJob).not.toContain('defaults read "$app_path/Contents/Info"');
    expect(releaseJob).toContain('echo "CSC_LINK=$certificate_path" >> "$GITHUB_ENV"');
    expect(releaseJob).toContain('"$' + '{CSC_LINK:-$RUNNER_TEMP/missing-signing-certificate}"');
  });
});
