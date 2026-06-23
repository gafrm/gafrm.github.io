// Build a polished Quarto publication page from Gabriel Frazer-McKee's public ORCID record.
//
// Source hierarchy:
// 1. ORCID determines which public works belong on the page.
// 2. Crossref, DataCite, and DOI content negotiation supply bibliographic metadata.
// 3. An optional ORCID Public API token can supply full ORCID contributor records.
// 4. _data/publication-overrides.json corrects incomplete or malformed records.

const ORCID_ID = "0000-0002-0860-6192";
const ORCID_URL = `https://orcid.org/${ORCID_ID}`;
const OUTPUT_FILE = "_generated/publications.md";
const OVERRIDES_FILE = "_data/publication-overrides.json";

const MAX_AUTHORS_BEFORE_TRUNCATION = 12;
const LEADING_AUTHORS_IN_TRUNCATED_LIST = 5;

const EXCLUDED_TYPES = new Set([
  "conference-abstract",
  "conference-poster",
  "conference-presentation",
  "lecture-speech",
]);

const TYPE_LABELS = new Map([
  ["journal-article", "Journal article"],
  ["book-chapter", "Book chapter"],
  ["book", "Book"],
  ["edited-book", "Edited book"],
  ["conference-paper", "Conference paper"],
  ["dissertation-thesis", "Thesis"],
  ["report", "Report"],
  ["preprint", "Preprint"],
  ["working-paper", "Working paper"],
  ["dictionary-entry", "Dictionary entry"],
  ["encyclopedia-entry", "Encyclopedia entry"],
  ["review", "Review"],
  ["other", "Scholarly output"],
  ["journal-issue", "Edited journal issue"],
]);

async function fileExists(path) {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

// During incremental preview, reuse the existing generated fragment.
// A full `quarto render` or `quarto run scripts/fetch-orcid.ts` refreshes it.
const isPreRender = Deno.env.get("QUARTO_PROJECT_INPUT_FILES") !== undefined;
const isFullRender = Deno.env.get("QUARTO_PROJECT_RENDER_ALL") === "1";

if (isPreRender && !isFullRender && await fileExists(OUTPUT_FILE)) {
  console.log("Using cached ORCID publication list.");
  Deno.exit(0);
}

function value(node) {
  return typeof node?.value === "string" ? node.value.trim() : "";
}

function htmlEscape(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeName(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTitle(text) {
  return normalizeName(text);
}

function isGabriel(name) {
  const normalized = normalizeName(name);
  return (
    normalized.includes("gabriel") &&
    (
      normalized.includes("frazer mckee") ||
      normalized === "gabriel mckee"
    )
  );
}

function authorFullName(author) {
  const literal = String(author?.literal ?? author?.name ?? "").trim();
  return literal || [author?.given, author?.family].filter(Boolean).join(" ").trim();
}

function deduplicateAuthors(authors) {
  const seen = new Set();
  const output = [];

  for (const author of authors ?? []) {
    const fullName = authorFullName(author);
    const key = normalizeName(fullName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(author);
  }

  return output;
}

function formatAuthorHtml(author) {
  const fullName = authorFullName(author);
  if (!fullName) return "";

  const escaped = htmlEscape(fullName);
  return isGabriel(fullName)
    ? `<strong class="publication-me">${escaped}</strong>`
    : escaped;
}

function joinAuthorsHtml(rawAuthors) {
  const authors = deduplicateAuthors(rawAuthors);
  const names = authors.map(formatAuthorHtml).filter(Boolean);

  if (names.length === 0) {
    return '<strong class="publication-me">Gabriel Frazer-McKee</strong>';
  }
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} <span class="author-amp">&amp;</span> ${names[1]}`;

  if (names.length <= MAX_AUTHORS_BEFORE_TRUNCATION) {
    return `${names.slice(0, -1).join(", ")}, <span class="author-amp">&amp;</span> ${names.at(-1)}`;
  }

  const gabrielIndex = authors.findIndex((author) => isGabriel(authorFullName(author)));
  const firstAuthors = names.slice(0, LEADING_AUTHORS_IN_TRUNCATED_LIST);
  const finalAuthor = names.at(-1);

  if (
    gabrielIndex >= 0 &&
    (
      gabrielIndex < LEADING_AUTHORS_IN_TRUNCATED_LIST ||
      gabrielIndex === names.length - 1
    )
  ) {
    return `${firstAuthors.join(", ")}, <span class="author-ellipsis">…</span>, <span class="author-amp">&amp;</span> ${finalAuthor}`;
  }

  if (gabrielIndex >= 0) {
    return `${firstAuthors.join(", ")}, <span class="author-ellipsis">…</span>, ${names[gabrielIndex]}, <span class="author-ellipsis">…</span>, <span class="author-amp">&amp;</span> ${finalAuthor}`;
  }

  return `${firstAuthors.join(", ")}, <span class="author-ellipsis">…</span>, <span class="author-amp">&amp;</span> ${finalAuthor}`;
}

function normalizeDoi(rawDoi) {
  return String(rawDoi ?? "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

function doiUrl(doi) {
  const [prefix, ...suffix] = doi.split("/");
  return `https://doi.org/${prefix}/${suffix.map(encodeURIComponent).join("/")}`;
}

function externalIds(work) {
  return work?.["external-ids"]?.["external-id"] ?? [];
}

function findDoi(work) {
  const doiRecord = externalIds(work).find((item) => {
    const type = String(item?.["external-id-type"] ?? "").toLowerCase();
    const relationship = String(item?.["external-id-relationship"] ?? "").toLowerCase();
    return type === "doi" && relationship !== "part-of";
  });

  return normalizeDoi(doiRecord?.["external-id-value"]);
}

function fallbackUrl(work) {
  const directUrl = value(work?.url);
  if (directUrl) return directUrl;

  for (const item of externalIds(work)) {
    const url = value(item?.["external-id-url"]);
    if (url) return url;
  }

  return "";
}

function preferredSummary(group) {
  const summaries = group?.["work-summary"] ?? [];

  return summaries.reduce((preferred, candidate) => {
    if (!preferred) return candidate;
    const preferredIndex = Number(preferred?.["display-index"] ?? 0);
    const candidateIndex = Number(candidate?.["display-index"] ?? 0);
    return candidateIndex > preferredIndex ? candidate : preferred;
  }, null);
}

function firstString(input) {
  if (Array.isArray(input)) return String(input[0] ?? "").trim();
  return String(input ?? "").trim();
}

function orcidSummaryMetadata(summary) {
  const title = value(summary?.title?.title) || "Untitled work";
  const subtitle = value(summary?.title?.subtitle);
  const fullTitle = subtitle ? `${title}: ${subtitle}` : title;
  const year = Number(value(summary?.["publication-date"]?.year)) || 0;
  const venue = value(summary?.["journal-title"]);
  const type = String(summary?.type ?? "other");
  const doi = findDoi(summary);

  return {
    title: fullTitle,
    originalTitle: fullTitle,
    year,
    venue,
    type,
    doi,
    url: doi ? doiUrl(doi) : fallbackUrl(summary),
    authors: [],
    volume: "",
    issue: "",
    pages: "",
    publisher: "",
    metadataSource: "ORCID summary",
  };
}

function orcidContributorName(contributor) {
  const creditName = value(contributor?.["credit-name"]);
  if (creditName) return { literal: creditName };

  const given = value(contributor?.["contributor-orcid"]?.["given-names"]);
  const family = value(contributor?.["contributor-orcid"]?.["family-name"]);
  if (given || family) return { given, family };

  return null;
}

function authorsFromFullOrcidWork(work) {
  const contributors = work?.contributors?.contributor ?? [];
  if (!Array.isArray(contributors) || contributors.length === 0) return [];

  const explicitAuthors = contributors.filter((contributor) => {
    const role = String(
      contributor?.["contributor-attributes"]?.["contributor-role"] ?? ""
    ).toLowerCase();

    return role === "author";
  });

  const selected = explicitAuthors.length > 0 ? explicitAuthors : contributors;
  return deduplicateAuthors(selected.map(orcidContributorName).filter(Boolean));
}

async function fullOrcidWork(summary) {
  const token = Deno.env.get("ORCID_ACCESS_TOKEN");
  if (!token) return null;

  const putCode = summary?.["put-code"];
  if (!putCode) return null;

  const url = `https://pub.orcid.org/v3.0/${ORCID_ID}/work/${putCode}`;
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "application/vnd.orcid+json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`full ORCID work request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error(`full ORCID work request returned ${contentType || "non-JSON content"}`);
  }

  return await response.json();
}

function cslMetadata(csl, source) {
  const authors = deduplicateAuthors(Array.isArray(csl?.author) ? csl.author : []);
  return {
    title: firstString(csl?.title),
    year: Number(csl?.issued?.["date-parts"]?.[0]?.[0]) || 0,
    venue: firstString(csl?.["container-title"]),
    authors,
    volume: String(csl?.volume ?? "").trim(),
    issue: String(csl?.issue ?? "").trim(),
    pages: String(csl?.page ?? csl?.["article-number"] ?? "").trim(),
    publisher: String(csl?.publisher ?? "").trim(),
    metadataSource: source,
  };
}

async function crossrefMetadata(doi) {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "gafrm-publications/1.0 (https://gafrm.github.io/)",
    },
  });

  if (!response.ok) throw new Error(`Crossref request failed (${response.status})`);

  const data = await response.json();
  const item = data?.message;
  if (!item) throw new Error("Crossref response contained no work");

  const authors = deduplicateAuthors(
    (item.author ?? []).map((author) => ({
      given: String(author?.given ?? "").trim(),
      family: String(author?.family ?? "").trim(),
    }))
  );

  return {
    title: firstString(item.title),
    year: Number(
      item?.published?.["date-parts"]?.[0]?.[0] ??
      item?.issued?.["date-parts"]?.[0]?.[0]
    ) || 0,
    venue: firstString(item["container-title"]),
    authors,
    volume: String(item.volume ?? "").trim(),
    issue: String(item.issue ?? "").trim(),
    pages: String(item.page ?? item["article-number"] ?? "").trim(),
    publisher: String(item.publisher ?? "").trim(),
    metadataSource: "Crossref",
  };
}

async function dataciteMetadata(doi) {
  const url = `https://api.datacite.org/dois/${encodeURIComponent(doi)}`;
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.api+json" },
  });

  if (!response.ok) throw new Error(`DataCite request failed (${response.status})`);

  const data = await response.json();
  const attributes = data?.data?.attributes;
  if (!attributes) throw new Error("DataCite response contained no attributes");

  const authors = deduplicateAuthors(
    (attributes.creators ?? []).map((creator) => {
      const given = String(creator?.givenName ?? "").trim();
      const family = String(creator?.familyName ?? "").trim();
      const name = String(creator?.name ?? "").trim();
      return given || family ? { given, family } : { literal: name };
    })
  );

  const titleRecord = Array.isArray(attributes.titles)
    ? attributes.titles.find((item) => !item?.titleType) ?? attributes.titles[0]
    : null;

  return {
    title: String(titleRecord?.title ?? "").trim(),
    year: Number(attributes.publicationYear) || 0,
    venue: String(attributes.container?.title ?? attributes.publisher ?? "").trim(),
    authors,
    volume: String(attributes.container?.volume ?? "").trim(),
    issue: String(attributes.container?.issue ?? "").trim(),
    pages: String(
      attributes.container?.firstPage && attributes.container?.lastPage
        ? `${attributes.container.firstPage}–${attributes.container.lastPage}`
        : attributes.container?.firstPage ?? ""
    ).trim(),
    publisher: String(attributes.publisher ?? "").trim(),
    metadataSource: "DataCite",
  };
}

async function negotiatedDoiMetadata(doi) {
  const response = await fetch(doiUrl(doi), {
    redirect: "follow",
    headers: {
      Accept: "application/vnd.citationstyles.csl+json",
    },
  });

  if (!response.ok) {
    throw new Error(`DOI content negotiation failed (${response.status})`);
  }

  return cslMetadata(await response.json(), "DOI CSL");
}

function metadataScore(candidate) {
  if (!candidate) return -1;

  let score = 0;
  score += (candidate.authors?.length ?? 0) * 100;
  if (candidate.title) score += 20;
  if (candidate.venue) score += 10;
  if (candidate.year) score += 5;
  if (candidate.volume) score += 2;
  if (candidate.issue) score += 2;
  if (candidate.pages) score += 3;
  return score;
}

async function bestDoiMetadata(doi) {
  const loaders = [
    () => crossrefMetadata(doi),
    () => dataciteMetadata(doi),
    () => negotiatedDoiMetadata(doi),
  ];

  const candidates = [];

  for (const load of loaders) {
    try {
      candidates.push(await load());
    } catch {
      // Registries do not all contain every DOI. Silence individual misses.
    }
  }

  if (candidates.length === 0) {
    throw new Error("no DOI metadata source returned a record");
  }

  return candidates.sort((a, b) => metadataScore(b) - metadataScore(a))[0];
}

async function loadOverrides() {
  if (!await fileExists(OVERRIDES_FILE)) return {};

  const raw = await Deno.readTextFile(OVERRIDES_FILE);
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function applyOverride(work, override) {
  if (!override || typeof override !== "object") return work;

  return {
    ...work,
    ...override,
    authors: Array.isArray(override.authors)
      ? deduplicateAuthors(override.authors)
      : work.authors,
    metadataSource: "local correction",
  };
}

function applyAllOverrides(work, summary, overrides) {
  const keys = [
    `title:${normalizeTitle(work.originalTitle)}`,
    `title:${normalizeTitle(work.title)}`,
    `orcid-put-code:${summary?.["put-code"]}`,
    work.doi,
  ].filter(Boolean);

  let corrected = work;
  for (const key of keys) {
    corrected = applyOverride(corrected, overrides[key]);
  }
  return corrected;
}

async function enrichWork(summary, overrides) {
  let work = orcidSummaryMetadata(summary);

  try {
    const fullWork = await fullOrcidWork(summary);

    if (fullWork) {
      const orcidAuthors = authorsFromFullOrcidWork(fullWork);
      if (orcidAuthors.length > 0) work.authors = orcidAuthors;
      work.url = work.url || fallbackUrl(fullWork);
      work.doi = work.doi || findDoi(fullWork);
      work.metadataSource = "full ORCID work";
    }
  } catch (error) {
    console.warn(`Could not retrieve full ORCID item ${summary?.["put-code"]}: ${error.message}`);
  }

  if (work.doi) {
    try {
      const doiRecord = await bestDoiMetadata(work.doi);

      work = {
        ...work,
        title: doiRecord.title || work.title,
        year: doiRecord.year || work.year,
        venue: doiRecord.venue || work.venue,
        authors: doiRecord.authors?.length ? doiRecord.authors : work.authors,
        volume: doiRecord.volume || work.volume,
        issue: doiRecord.issue || work.issue,
        pages: doiRecord.pages || work.pages,
        publisher: doiRecord.publisher || work.publisher,
        url: work.url || doiUrl(work.doi),
        metadataSource: doiRecord.metadataSource,
      };
    } catch (error) {
      if (!overrides[work.doi]) {
        console.warn(`Could not enrich DOI ${work.doi}: ${error.message}`);
      }
    }
  }

  work = applyAllOverrides(work, summary, overrides);

  if (!Array.isArray(work.authors) || work.authors.length === 0) {
    console.warn(`Author metadata needs review: ${work.title}`);
    work.authors = [{ given: "Gabriel", family: "Frazer-McKee" }];
  }

  return work;
}

function venueText(work) {
  const pieces = [];
  const venue = work.venue || work.publisher;

  if (venue) pieces.push(`<cite>${htmlEscape(venue)}</cite>`);

  let volumeIssue = "";
  if (work.volume) volumeIssue += htmlEscape(work.volume);
  if (work.issue) volumeIssue += `(${htmlEscape(work.issue)})`;
  if (volumeIssue) pieces.push(volumeIssue);

  if (work.pages) pieces.push(htmlEscape(work.pages));

  return pieces.join(", ");
}

function renderWork(work) {
  const title = htmlEscape(work.title);
  const titleHtml = work.url
    ? `<a class="publication-title" href="${htmlEscape(work.url)}">${title}</a>`
    : `<span class="publication-title">${title}</span>`;

  const typeLabel = TYPE_LABELS.get(work.type) ?? work.type.replaceAll("-", " ");
  const metaPieces = [];

  const venue = venueText(work);
  if (venue) metaPieces.push(`<span class="publication-venue">${venue}</span>`);

  metaPieces.push(`<span class="publication-type">${htmlEscape(typeLabel)}</span>`);

  if (work.doi) {
    metaPieces.push(
      `<a class="publication-doi" href="${htmlEscape(doiUrl(work.doi))}" aria-label="Open DOI">DOI</a>`
    );
  }

  return [
    '<article class="publication-entry">',
    `  <div class="publication-title-row">${titleHtml}</div>`,
    `  <div class="publication-authors">${joinAuthorsHtml(work.authors)}</div>`,
    `  <div class="publication-meta">${metaPieces.join('<span class="publication-dot">·</span>')}</div>`,
    "</article>",
  ].join("\n");
}

function renderPublicationList(works) {
  const byYear = new Map();

  for (const work of works) {
    const yearLabel = work.year || "Forthcoming";
    if (!byYear.has(yearLabel)) byYear.set(yearLabel, []);
    byYear.get(yearLabel).push(work);
  }

  const years = [...byYear.keys()].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return b - a;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return String(a).localeCompare(String(b));
  });

  const output = ['<div class="publications-list">'];

  for (const year of years) {
    output.push(
      '<section class="publication-year">',
      `  <h2>${htmlEscape(year)}</h2>`,
      '  <div class="publication-year-entries">'
    );

    const yearWorks = byYear.get(year).sort((a, b) =>
      a.title.localeCompare(b.title, "en", { sensitivity: "base" })
    );

    for (const work of yearWorks) {
      output.push(renderWork(work));
    }

    output.push("  </div>", "</section>");
  }

  output.push(
    "</div>",
    `<p class="publications-source">Publication selection is synchronized with <a href="${ORCID_URL}">ORCID</a>.</p>`,
    ""
  );

  return output.join("\n");
}

async function writeOnlyIfChanged(path, content) {
  await Deno.mkdir(path.substring(0, path.lastIndexOf("/")), { recursive: true });

  let existing = "";
  try {
    existing = await Deno.readTextFile(path);
  } catch {
    // The file does not exist yet.
  }

  if (existing === content) {
    console.log("ORCID publication list is already current.");
    return;
  }

  await Deno.writeTextFile(path, content);
  console.log(`Updated ${path}.`);
}

try {
  const overrides = await loadOverrides();

  const response = await fetch(ORCID_URL, {
    redirect: "follow",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`ORCID request failed (${response.status})`);
  }

  const record = await response.json();
  const groups = record?.["activities-summary"]?.works?.group ?? [];

  const summaries = groups
    .map(preferredSummary)
    .filter(Boolean)
    .filter((summary) => !EXCLUDED_TYPES.has(String(summary?.type ?? "")));

  if (summaries.length === 0) {
    throw new Error("No public works were found in the ORCID record.");
  }

  const works = [];
  for (const summary of summaries) {
    works.push(await enrichWork(summary, overrides));
  }

  await writeOnlyIfChanged(OUTPUT_FILE, renderPublicationList(works));
} catch (error) {
  if (await fileExists(OUTPUT_FILE)) {
    console.warn(`Publication refresh failed; keeping the cached list. ${error.message}`);
    Deno.exit(0);
  }

  console.error(`Could not generate the publication list. ${error.message}`);
  Deno.exit(1);
}
