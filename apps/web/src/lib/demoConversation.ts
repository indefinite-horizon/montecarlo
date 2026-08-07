/** Seed content that demonstrates Monte Carlo's branch-first conversation model. */

import type { ChatBranch, ChatSummary, ProjectSummary } from "./conversation";

const now = Date.now();

export const demoWorkspace = {
  id: "workspace-demo",
  publicId: "workspace-demo",
  name: "My Workspace",
  storageMode: "local",
} as const;

export const demoProjects: ProjectSummary[] = [
  {
    id: "project-probability",
    publicId: "project-probability",
    name: "Probability lab",
    color: "terracotta",
  },
  {
    id: "project-writing",
    publicId: "project-writing",
    name: "Writing desk",
    color: "blue",
  },
];

export const demoChats: ChatSummary[] = [
  {
    id: "chat-convergence",
    publicId: "chat-convergence",
    rootBranchPublicId: "branch-root",
    projectId: "project-probability",
    title: "Why simulations converge",
    updatedAt: now,
    branchCount: 4,
  },
  {
    id: "chat-bayesian",
    publicId: "chat-bayesian",
    rootBranchPublicId: "branch-root-chat-bayesian",
    projectId: "project-probability",
    title: "Bayesian priors, visually",
    updatedAt: now - 86_400_000,
    branchCount: 1,
  },
  {
    id: "chat-essay",
    publicId: "chat-essay",
    rootBranchPublicId: "branch-root-chat-essay",
    projectId: "project-writing",
    title: "Notes on useful uncertainty",
    updatedAt: now - 172_800_000,
    branchCount: 2,
  },
  {
    id: "chat-unfiled",
    publicId: "chat-unfiled",
    rootBranchPublicId: "branch-root-chat-unfiled",
    title: "A quick question about entropy",
    updatedAt: now - 259_200_000,
    branchCount: 1,
  },
];

export const demoBranches: ChatBranch[] = [
  {
    id: "branch-root",
    publicId: "branch-root",
    title: "Main thread",
    depth: 0,
    createdAt: now - 420_000,
    messages: [
      {
        id: "message-question",
        branchId: "branch-root",
        role: "user",
        content:
          "Why does a Monte Carlo estimate become more trustworthy as I add samples? Explain it without hiding behind the law of large numbers.",
        createdAt: now - 420_000,
      },
      {
        id: "message-answer",
        branchId: "branch-root",
        role: "assistant",
        provider: "codex",
        model: "gpt-5.6-sol",
        createdAt: now - 405_000,
        content:
          "Imagine every sample as a tiny, noisy vote about the quantity you want. A single vote can be wildly unlucky. When the votes are independent, their positive and negative mistakes tend to cancel instead of marching in the same direction.\n\nThe useful part is not merely that the estimate converges, but the rate at which its uncertainty contracts. For ordinary Monte Carlo, the standard error is proportional to `1 / sqrt(n)`. Four times as many samples usually halves the noise; one hundred times as many samples gives roughly one extra decimal digit.\n\nThat square-root rate is stubborn. Better random-number generators protect you from accidental patterns, while variance-reduction methods change how much noise each sample contributes. They do not make evidence free: they make each unit of computation cast a better vote.",
      },
    ],
  },
  {
    id: "branch-rate",
    publicId: "branch-rate",
    parentBranchId: "branch-root",
    title: "The square-root rate",
    depth: 1,
    createdAt: now - 300_000,
    anchor: {
      sourceMessageId: "message-answer",
      selectedText: "For ordinary Monte Carlo, the standard error is proportional to 1 / sqrt(n).",
      selectionStart: 254,
      selectionEnd: 334,
      prompt: "Where does that rate come from geometrically?",
    },
    messages: [
      {
        id: "message-rate-question",
        branchId: "branch-rate",
        role: "user",
        content: "Where does that rate come from geometrically?",
        createdAt: now - 300_000,
      },
      {
        id: "message-rate-answer",
        branchId: "branch-rate",
        role: "assistant",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.6",
        createdAt: now - 285_000,
        content:
          "Picture the error from `n` independent samples as a random walk. The typical distance wandered grows like `sqrt(n)`, not like `n`. The estimate divides that accumulated error by the number of samples, leaving `sqrt(n) / n = 1 / sqrt(n)`.\n\nGeometrically, independent errors spread into many directions. Their vector sum grows with the radius of the cloud, while averaging divides by the number of points in it.",
      },
    ],
  },
  {
    id: "branch-variance",
    publicId: "branch-variance",
    parentBranchId: "branch-root",
    title: "Variance reduction",
    depth: 1,
    createdAt: now - 235_000,
    anchor: {
      sourceMessageId: "message-answer",
      selectedText: "variance-reduction methods change how much noise each sample contributes",
      selectionStart: 598,
      selectionEnd: 670,
      prompt: "Compare the most practical techniques.",
    },
    messages: [
      {
        id: "message-variance-question",
        branchId: "branch-variance",
        role: "user",
        content: "Compare the most practical techniques.",
        createdAt: now - 235_000,
      },
      {
        id: "message-variance-answer",
        branchId: "branch-variance",
        role: "assistant",
        provider: "ollama",
        model: "qwen3:8b",
        createdAt: now - 220_000,
        content:
          "Antithetic sampling pairs outcomes that err in opposite directions. Control variates subtract noise using a correlated quantity whose expectation you already know. Stratification forces coverage across important regions instead of trusting chance to visit each one.\n\nIn practice, control variates often offer the best effort-to-gain ratio when a strong proxy is available. Stratification is easier to explain and audit. Importance sampling can be dramatic for rare events, but a poor proposal distribution can make variance worse.",
      },
    ],
  },
  {
    id: "branch-rare-events",
    publicId: "branch-rare-events",
    parentBranchId: "branch-variance",
    title: "Rare-event failures",
    depth: 2,
    createdAt: now - 110_000,
    anchor: {
      sourceMessageId: "message-variance-answer",
      selectedText: "a poor proposal distribution can make variance worse",
      selectionStart: 478,
      selectionEnd: 531,
      prompt: "Show me a concrete failure mode.",
    },
    messages: [
      {
        id: "message-rare-question",
        branchId: "branch-rare-events",
        role: "user",
        content: "Show me a concrete failure mode.",
        createdAt: now - 110_000,
      },
    ],
  },
];
