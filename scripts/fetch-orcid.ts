// Generate a Quarto publication list from Gabriel Frazer-McKee's public ORCID record.
//
// Data hierarchy:
// 1. ORCID determines which public works belong on the page.
// 2. DOI citation metadata supplies the preferred bibliographic record.
// 3. The full ORCID work record supplies contributors when DOI metadata is absent/incomplete.
// 4. _data/publication-overrides.json corrects known publisher or registry errors.

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
  ["other", "Other scholarly output"],
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

function markdownText(text) {
  return String(text ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function normalizeName(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isGabriel(name) {
  const normalized = normalizeName(name);
  return normalized.includes("gabriel") && normalized.includes("frazer mckee");
}

function authorFullName(author) {
  const literal = String(author?.literal ?? "").trim();
  return literal || [author?.given, author?.family].filter(Boolean).join(" ").trim();
}

function formatAuthorName(author) {
  const fullName = authorFullName(author);
  if (!fullName) return "";

  const escaped = markdownText(fullName);
  return isGabriel(fullName) ? `**${escaped}**` : escaped;
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

function joinAuthors(rawAuthors) {
  const authors = deduplicateAuthors(rawAuthors);
  const names = authors.map(formatAuthorName).filter(Boolean);

  if (names.length === 0) return "**Gabriel Frazer-McKee**";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;

  if (names.length <= MAX_AUTHORS_BEFORE_TRUNCATION) {
    return `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}`;
  }

  const gabrielIndex = authors.findIndex((author) => isGabriel(authorFullName(author)));
  const firstAuthors = names.slice(0, LEADING_AUTHORS_IN_TRUNCATED_LIST);
  const finalAuthor = names.at(-1);

  if (gabrielIndex >= 0 && gabrielIndex < LEADING_AUTHORS_IN_TRUNCATED_LIST) {
    return `${firstAuthors.join(", ")}, …, & ${finalAuthor}`;
  }

  if (gabrielIndex === names.length - 1) {
    return `${firstAuthors.join(", ")}, …, & ${finalAuthor}`;
  }

  if (gabrielIndex >= 0) {
    return `${firstAuthors.join(", ")}, …, ${names[gabrielIndex]}, …, & ${finalAuthor}`;
  }

  return `${firstAuthors.join(", ")}, …, & ${finalAuthor}`;
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

  const authorContributors = contributors.filter((contributor) => {
    const role = String(
      contributor?.["contributor-attributes"]?.["contributor-role"] ?? ""
    ).toLowerCase();

    return role === "author";
  });

  // Some deposits omit the role, or incorrectly repeat every contributor for several roles.
  // Prefer explicit authors when available, then deduplicate by normalized name.
  const selected = authorContributors.length > 0 ? authorContributors : contributors;

  return deduplicateAuthors(
    selected.map(orcidContributorName).filter(Boolean)
  );
}

async function fullOrcidWork(summary) {
  const putCode = summary?.["put-code"];
  if (!putCode) return null;

  const path = summary?.path || `/${ORCID_ID}/work/${putCode}`;
  const url = path.startsWith("http")
    ? path
    : `https://orcid.org${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`full ORCID work request failed (${response.status})`);
  }

  return await response.json();
}

async function doiMetadata(doi) {
  const response = await fetch(doiUrl(doi), {
    redirect: "follow",
    headers: {
      Accept: "application/vnd.citationstyles.csl+json",
    },
  });

  if (!response.ok) {
    throw new Error(`DOI metadata request failed (${response.status})`);
  }

  return await response.json();
}

async function loadOverrides() {
  if (!await fileExists(OVERRIDES_FILE)) return {};

  try {
    const raw = await Deno.readTextFile(OVERRIDES_FILE);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    throw new Error(`Could not read ${OVERRIDES_FILE}: ${error.message}`);
  }
}

function applyOverride(work, override) {
  if (!override || typeof override !== "object") return work;

  return {
    ...work,
    ...override,
    authors: Array.isArray(override.authors)
      ? deduplicateAuthors(override.authors)
      : work.authors,
  };
}

async function enrichWork(summary, overrides) {
  let work = orcidSummaryMetadata(summary);
  let fullWork = null;

  // Fetch the full ORCID item so non-DOI works can retain their contributors.
  try {
    fullWork = await fullOrcidWork(summary);
    const orcidAuthors = authorsFromFullOrcidWork(fullWork);
    if (orcidAuthors.length > 0) {
      work.authors = orcidAuthors;
    }

    // The full item can contain a better URL or identifiers than the summary.
    work.url = work.url || fallbackUrl(fullWork);
    work.doi = work.doi || findDoi(fullWork);
  } catch (error) {
    console.warn(`Could not retrieve full ORCID item ${summary?.["put-code"]}: ${error.message}`);
  }

  // For DOI works, prefer registry/publisher citation metadata over ORCID contributor roles.
  if (work.doi) {
    try {
      const csl = await doiMetadata(work.doi);
      const cslAuthors = deduplicateAuthors(
        Array.isArray(csl?.author) ? csl.author : []
      );
      const cslYear = Number(csl?.issued?.["date-parts"]?.[0]?.[0]) || work.year;

      work = {
        ...work,
        title: firstString(csl?.title) || work.title,
        year: cslYear,
        venue: firstString(csl?.["container-title"]) || work.venue,
        authors: cslAuthors.length > 0 ? cslAuthors : work.authors,
        volume: String(csl?.volume ?? "").trim(),
        issue: String(csl?.issue ?? "").trim(),
        pages: String(csl?.page ?? csl?.["article-number"] ?? "").trim(),
        publisher: String(csl?.publisher ?? "").trim(),
        url: work.url || doiUrl(work.doi),
      };
    } catch (error) {
      console.warn(`Could not enrich DOI ${work.doi}: ${error.message}`);
    }
  }

  // Key overrides by normalized DOI. For a non-DOI item, a future override may use
  // "orcid-put-code:<number>".
  const overrideKey = work.doi
    ? work.doi
    : `orcid-put-code:${summary?.["put-code"]}`;

  work = applyOverride(work, overrides[overrideKey]);

  if (!Array.isArray(work.authors) || work.authors.length === 0) {
    work.authors = [{ given: "Gabriel", family: "Frazer-McKee" }];
  }

  return work;
}

function venueLine(work) {
  const venue = work.venue || work.publisher;
  let bibliographic = venue ? `*${markdownText(venue)}*` : "";

  if (work.volume) {
    bibliographic += `${bibliographic ? ", " : ""}${markdownText(work.volume)}`;
  }
  if (work.issue) {
    bibliographic += `(${markdownText(work.issue)})`;
  }
  if (work.pages) {
    bibliographic += `${bibliographic ? ", " : ""}${markdownText(work.pages)}`;
  }

  return bibliographic;
}

function renderWork(work) {
  const title = markdownText(work.title);
  const linkedTitle = work.url
    ? `**[${title}](<${work.url}>)**`
    : `**${title}**`;

  const authors = joinAuthors(work.authors);
  const details = [];
  const venue = venueLine(work);
  if (venue) details.push(venue);

  details.push(TYPE_LABELS.get(work.type) ?? work.type.replaceAll("-", " "));

  if (work.doi) {
    details.push(`[DOI](<${doiUrl(work.doi)}>)`);
  }

  return [
    "::: {.publication-entry}",
    `${linkedTitle}  `,
    `${authors}  `,
    details.join(" · "),
    ":::",
    "",
  ].join("\n");
}

function renderPublicationList(works) {
  const byYear = new Map();

  for (const work of works) {
    const yearLabel = work.year || "Forthcoming / undated";
    if (!byYear.has(yearLabel)) byYear.set(yearLabel, []);
    byYear.get(yearLabel).push(work);
  }

  const years = [...byYear.keys()].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return b - a;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return String(a).localeCompare(String(b));
  });

  const output = [];

  for (const year of years) {
    output.push(`## ${year}`, "");

    const yearWorks = byYear.get(year).sort((a, b) =>
      a.title.localeCompare(b.title, "en", { sensitivity: "base" })
    );

    for (const work of yearWorks) {
      output.push(renderWork(work));
    }
  }

  output.push(
    `<p class="publications-source">Works are selected from <a href="${ORCID_URL}" target="_blank" rel="noopener">ORCID</a>; bibliographic metadata is resolved from DOI records where available.</p>`,
    "",
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

  // Process sequentially to avoid unnecessary bursts against ORCID and DOI services.
  const works = [];
  for (const summary of summaries) {
    works.push(await enrichWork(summary, overrides));
  }

  const content = renderPublicationList(works);
  await writeOnlyIfChanged(OUTPUT_FILE, content);
} catch (error) {
  if (await fileExists(OUTPUT_FILE)) {
    console.warn(`Publication refresh failed; keeping the cached list. ${error.message}`);
    Deno.exit(0);
  }

  console.error(`Could not generate the publication list. ${error.message}`);
  Deno.exit(1);
}
