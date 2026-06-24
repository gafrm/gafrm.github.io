// Compatibility shim.
// CV generation is now handled entirely by scripts/fetch-orcid.ts so that
// publications, funding, distinctions, peer review, and memberships are
// written once and cannot overwrite one another.
console.log("CV generation is handled by scripts/fetch-orcid.ts; skipping legacy fetch-cv.ts.");
