import type { LensSpec } from "@paper-xray/contracts";

/**
 * The four preset org-server lenses (docs/01-nabcd-architecture.md "A —
 * 方法" / "对读者" section): methodology review, experiment & statistics,
 * reproducibility, novelty. Users don't get an open-ended prompt box — this
 * is the declarative LensSpec contract instead (docs/01 "能力与运行时分离").
 */
export const PRESET_LENSES: LensSpec[] = [
  {
    id: "preset-methodology-review",
    name: "Methodology Review",
    description: "Flags places where the authors' method choice looks non-obvious or under-justified.",
    version: "1.0.0",
    kind: "model",
    scope: "all",
    instruction:
      "Read the paper's method section(s). For each place where the authors make a non-obvious design choice " +
      "(an algorithm, architecture, baseline, or hyperparameter choice) without justifying why they didn't use a " +
      "more standard or simpler alternative, quote the exact sentence(s) describing that choice and explain in one " +
      "or two sentences what the plausible alternative was and why its absence is worth a reader's attention.",
    outputSchema: { requiresEvidenceSpan: true, requiresComment: true, requiresSeverity: true },
    maxAnnotations: 6,
    executionContext: "org-server",
    ownerId: null,
    strictScope: false,
    shareRunsWithOrg: true,
  },
  {
    id: "preset-experiment-stats",
    name: "Experiment & Statistics",
    description: "Flags experimental comparisons or statistical claims that look unsound.",
    version: "1.0.0",
    kind: "model",
    scope: "all",
    instruction:
      "Read the paper's experiments/results section(s). Look for comparisons where the compared methods differ in " +
      "parameter count, training data, or compute budget without that being controlled for or disclosed, missing " +
      "confidence intervals or significance tests on claimed improvements, or conclusions that overstate what the " +
      "reported numbers actually support. Quote the exact claim or table caption and explain the specific issue.",
    outputSchema: { requiresEvidenceSpan: true, requiresComment: true, requiresSeverity: true },
    maxAnnotations: 6,
    executionContext: "org-server",
    ownerId: null,
    strictScope: false,
    shareRunsWithOrg: true,
  },
  {
    id: "preset-reproducibility",
    name: "Reproducibility",
    description: "Flags missing information a reader would need to reproduce the work.",
    version: "1.0.0",
    kind: "model",
    scope: "all",
    instruction:
      "Look for places where the paper describes a method, dataset, or experiment but omits a detail a competent " +
      "reader would need to reproduce it — e.g. hyperparameters, dataset version/split, preprocessing steps, or " +
      "compute environment. Quote the exact sentence describing the under-specified step and name the missing detail.",
    outputSchema: { requiresEvidenceSpan: true, requiresComment: true, requiresSeverity: true },
    maxAnnotations: 6,
    executionContext: "org-server",
    ownerId: null,
    strictScope: false,
    shareRunsWithOrg: true,
  },
  {
    id: "preset-novelty",
    name: "Novelty",
    description: "Flags claims of novelty that aren't clearly differentiated from prior work cited in the paper.",
    version: "1.0.0",
    kind: "model",
    scope: "all",
    instruction:
      "Look for sentences where the paper claims a contribution is new, first, or novel. For each, check whether " +
      "the paper's own related-work/citations already describe something similar without a clear stated difference. " +
      "Quote the novelty claim and explain what makes it under-differentiated, if anything.",
    outputSchema: { requiresEvidenceSpan: true, requiresComment: true, requiresSeverity: true },
    maxAnnotations: 6,
    executionContext: "org-server",
    ownerId: null,
    strictScope: false,
    shareRunsWithOrg: true,
  },
];
