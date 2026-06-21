// Generate a Quarto publication list from Gabriel Frazer-McKee's public ORCID record.
// Quarto runs TypeScript with its bundled Deno runtime, so no Python packages are needed.

const ORCID_ID = "0000-0002-0860-6192";
const ORCID_URL = `https://orcid.org/${ORCID_ID}`;
const OUTPUT_FILE = "_generated/publications.md";

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
// A full `quarto render` or a manual `quarto run scripts/fetch-orcid.ts` refreshes it.
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

function formatAuthorName(author) {
  const literal = author?.literal?.trim();
  const fullName = literal || [author?.given, author?.family].filter(Boolean).join(" ").trim();
  if (!fullName) return "";

  const escaped = markdownText(fullName);
  return isGabriel(fullName) ? `**${escaped}**` : escaped;
}

function joinAuthors(authors) {
  const authorList = authors ?? [];

  const names = authorList
    .map(formatAuthorName)
    .filter(Boolean);

  if (names.length === 0) {
    return "**Gabriel Frazer-McKee**";
  }

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} & ${names[1]}`;
  }

  // Display ordinary author lists in full.
  if (names.length <= 12) {
    return `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}`;
  }

  // For very large collaborations, show the first authors,
  // Gabriel's name, and the final author.
  const gabrielIndex = authorList.findIndex((author) => {
    const literal = author?.literal?.trim();
    const fullName =
      literal ||
      [author?.given, author?.family]
        .filter(Boolean)
        .join(" ")
        .trim();

    return isGabriel(fullName);
  });

  const firstAuthors = names.slice(0, 5);
  const finalAuthor = names.at(-1);

  if (gabrielIndex >= 0 && gabrielIndex < 5) {
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
    .replace(/^doi:\s*/i, "");
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

function orcidFallback(summary) {
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
    authors: [{ given: "Gabriel", family: "Frazer-McKee" }],
    volume: "",
    issue: "",
    pages: "",
    publisher: "",
  };
}

function firstString(input) {
  if (Array.isArray(input)) return String(input[0] ?? "").trim();
  return String(input ?? "").trim();
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

async function enrichWork(summary) {
  const fallback = orcidFallback(summary);
  if (!fallback.doi) return fallback;

  try {
    const csl = await doiMetadata(fallback.doi);
    const cslYear = Number(csl?.issued?.["date-parts"]?.[0]?.[0]) || fallback.year;

    return {
      ...fallback,
      title: firstString(csl?.title) || fallback.title,
      year: cslYear,
      venue: firstString(csl?.["container-title"]) || fallback.venue,
      authors: Array.isArray(csl?.author) && csl.author.length > 0
        ? csl.author
        : fallback.authors,
      volume: String(csl?.volume ?? "").trim(),
      issue: String(csl?.issue ?? "").trim(),
      pages: String(csl?.page ?? csl?.["article-number"] ?? "").trim(),
      publisher: String(csl?.publisher ?? "").trim(),
      url: fallback.url,
    };
  } catch (error) {
    console.warn(`Could not enrich DOI ${fallback.doi}: ${error.message}`);
    return fallback;
  }
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
    `<p class="publications-source">Source: <a href="${ORCID_URL}" target="_blank" rel="noopener">ORCID</a>. DOI metadata is resolved when the site is built.</p>`,
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

  const works = await Promise.all(summaries.map(enrichWork));
  const content = renderPublicationList(works);
  await writeOnlyIfChanged(OUTPUT_FILE, content);
} catch (error) {
  if (await fileExists(OUTPUT_FILE)) {
    console.warn(`ORCID refresh failed; keeping the cached list. ${error.message}`);
    Deno.exit(0);
  }

  console.error(`Could not generate the publication list. ${error.message}`);
  Deno.exit(1);
}
