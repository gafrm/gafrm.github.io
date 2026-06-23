// Generate the ORCID-synchronised sections of Gabriel Frazer-McKee's CV.
//
// Every Quarto project render attempts a live refresh. If ORCID or a DOI
// service is temporarily unavailable, the last generated fragment is retained.
//
// Public ORCID summaries require no credentials. Optional environment variables
// enrich contributor and funding details through ORCID's Public API:
//   ORCID_ACCESS_TOKEN
// or
//   ORCID_CLIENT_ID and ORCID_CLIENT_SECRET

const ORCID_ID = "0000-0002-0860-6192";
const ORCID_PROFILE_URL = `https://orcid.org/${ORCID_ID}`;
const ORCID_API_BASE = `https://pub.orcid.org/v3.0/${ORCID_ID}`;
const OUTPUT_FILE = "_generated/cv-orcid.md";
const PUBLICATION_OVERRIDES_FILE = "_data/publication-overrides.json";
const CV_OVERRIDES_FILE = "_data/cv-overrides.json";

const PUBLICATION_SECTIONS = [
  ["journal-article", "Journal articles"],
  ["book", "Books"],
  ["book-chapter", "Book chapters"],
  ["edited-book", "Edited volumes and journal issues"],
  ["journal-issue", "Edited volumes and journal issues"],
  ["conference-paper", "Conference proceedings"],
  ["working-paper", "Working papers"],
  ["preprint", "Preprints"],
  ["report", "Reports"],
  ["dissertation-thesis", "Theses"],
];

const PUBLICATION_SECTION_ORDER = [
  "Journal articles",
  "Books",
  "Book chapters",
  "Edited volumes and journal issues",
  "Conference proceedings",
  "Working papers",
  "Preprints",
  "Reports",
  "Theses",
  "Other scholarly outputs",
];

const SECTION_BY_TYPE = new Map(PUBLICATION_SECTIONS);
const MAX_AUTHORS_BEFORE_TRUNCATION = 20;
const LEADING_AUTHORS_IN_TRUNCATED_LIST = 8;

async function fileExists(path) {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

function value(node) {
  if (typeof node === "string" || typeof node === "number") {
    return String(node).trim();
  }
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

function deduplicateAuthors(authors) {
  const seen = new Set();
  const output = [];
  for (const author of authors ?? []) {
    const name = authorFullName(author);
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(author);
  }
  return output;
}

function formatAuthor(author) {
  const name = markdownText(authorFullName(author));
  return isGabriel(name) ? `**${name}**` : name;
}

function joinAuthors(rawAuthors) {
  const authors = deduplicateAuthors(rawAuthors);
  const names = authors.map(formatAuthor).filter(Boolean);
  if (names.length === 0) return "**Gabriel Frazer-McKee**";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length <= MAX_AUTHORS_BEFORE_TRUNCATION) {
    return `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}`;
  }

  const gabrielIndex = authors.findIndex((author) => isGabriel(authorFullName(author)));
  const first = names.slice(0, LEADING_AUTHORS_IN_TRUNCATED_LIST);
  const last = names.at(-1);
  if (gabrielIndex >= 0 && gabrielIndex < LEADING_AUTHORS_IN_TRUNCATED_LIST) {
    return `${first.join(", ")}, …, & ${last}`;
  }
  if (gabrielIndex === names.length - 1) {
    return `${first.join(", ")}, …, & ${last}`;
  }
  if (gabrielIndex >= 0) {
    return `${first.join(", ")}, …, ${names[gabrielIndex]}, …, & ${last}`;
  }
  return `${first.join(", ")}, …, & ${last}`;
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

function externalIds(item) {
  return item?.["external-ids"]?.["external-id"] ?? [];
}

function findExternalId(item, acceptedTypes) {
  const accepted = new Set(acceptedTypes.map((type) => type.toLowerCase()));
  return externalIds(item).find((identifier) => {
    const type = String(identifier?.["external-id-type"] ?? "").toLowerCase();
    const relationship = String(identifier?.["external-id-relationship"] ?? "").toLowerCase();
    return accepted.has(type) && relationship !== "part-of";
  });
}

function findDoi(item) {
  return normalizeDoi(findExternalId(item, ["doi"])?.["external-id-value"]);
}

function fallbackUrl(item) {
  const direct = value(item?.url);
  if (direct) return direct;
  for (const identifier of externalIds(item)) {
    const url = value(identifier?.["external-id-url"]);
    if (url) return url;
  }
  return "";
}

function datePart(date, part) {
  return value(date?.[part]);
}

function yearOf(date) {
  const year = Number(datePart(date, "year"));
  return Number.isFinite(year) ? year : 0;
}

function formatDateRange(startDate, endDate) {
  const start = yearOf(startDate);
  const end = yearOf(endDate);
  if (start && end && start !== end) return `${start}–${end}`;
  if (start) return String(start);
  if (end) return String(end);
  return "";
}

function preferredByDisplayIndex(items) {
  return (items ?? []).reduce((preferred, candidate) => {
    if (!preferred) return candidate;
    const preferredIndex = Number(preferred?.["display-index"] ?? 0);
    const candidateIndex = Number(candidate?.["display-index"] ?? 0);
    return candidateIndex > preferredIndex ? candidate : preferred;
  }, null);
}

function directSummaries(group, summaryKey) {
  const values = [];
  const direct = group?.[summaryKey];
  if (Array.isArray(direct)) values.push(...direct);
  else if (direct) values.push(direct);

  for (const wrapper of group?.summaries ?? []) {
    const nested = wrapper?.[summaryKey];
    if (Array.isArray(nested)) values.push(...nested);
    else if (nested) values.push(nested);
  }
  return values;
}

function collectSummaries(section, summaryKey) {
  const groups = section?.group ?? section?.["affiliation-group"] ?? [];
  const grouped = [];
  for (const group of groups) {
    const preferred = preferredByDisplayIndex(directSummaries(group, summaryKey));
    if (preferred) grouped.push(preferred);
  }
  if (grouped.length > 0) return deduplicateSummaries(grouped);

  const found = [];
  function walk(node) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const direct = node[summaryKey];
    if (Array.isArray(direct)) found.push(...direct);
    else if (direct) found.push(direct);
    for (const [key, nested] of Object.entries(node)) {
      if (key !== summaryKey) walk(nested);
    }
  }
  walk(section);
  return deduplicateSummaries(found);
}

function deduplicateSummaries(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = String(item?.["put-code"] ?? "") || JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

async function readJsonIfExists(path, fallback = {}) {
  if (!await fileExists(path)) return fallback;
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { redirect: "follow", ...options });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error(`${url} returned ${contentType || "non-JSON content"}`);
  }
  return await response.json();
}

async function obtainAccessToken() {
  const directToken = Deno.env.get("ORCID_ACCESS_TOKEN")?.trim();
  if (directToken) return directToken;

  const clientId = Deno.env.get("ORCID_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("ORCID_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) return "";

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "/read-public",
  });

  const tokenResponse = await fetchJson("https://orcid.org/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return String(tokenResponse?.access_token ?? "").trim();
}

async function fetchApiItem(kind, putCode, token) {
  if (!token || !putCode) return null;
  return await fetchJson(`${ORCID_API_BASE}/${kind}/${putCode}`, {
    headers: {
      Accept: "application/vnd.orcid+json",
      Authorization: `Bearer ${token}`,
    },
  });
}

function firstString(input) {
  if (Array.isArray(input)) return String(input[0] ?? "").trim();
  return String(input ?? "").trim();
}

function titleFromWork(item) {
  const title = value(item?.title?.title) || "Untitled work";
  const subtitle = value(item?.title?.subtitle);
  return subtitle ? `${title}: ${subtitle}` : title;
}

function authorsFromFullWork(work) {
  const contributors = work?.contributors?.contributor ?? [];
  if (!Array.isArray(contributors)) return [];
  const explicitAuthors = contributors.filter((contributor) => {
    const role = String(contributor?.["contributor-attributes"]?.["contributor-role"] ?? "").toLowerCase();
    return role === "author";
  });
  const selected = explicitAuthors.length > 0 ? explicitAuthors : contributors;
  return deduplicateAuthors(selected.map((contributor) => {
    const credit = value(contributor?.["credit-name"]);
    if (credit) return { literal: credit };
    const given = value(contributor?.["contributor-orcid"]?.["given-names"]);
    const family = value(contributor?.["contributor-orcid"]?.["family-name"]);
    return given || family ? { given, family } : null;
  }).filter(Boolean));
}

async function doiMetadata(doi) {
  return await fetchJson(doiUrl(doi), {
    headers: { Accept: "application/vnd.citationstyles.csl+json" },
  });
}

function applyOverride(item, override) {
  if (!override || typeof override !== "object") return item;
  return {
    ...item,
    ...override,
    authors: Array.isArray(override.authors)
      ? deduplicateAuthors(override.authors)
      : item.authors,
  };
}

async function buildWork(summary, token, publicationOverrides, cvOverrides) {
  let work = {
    putCode: summary?.["put-code"],
    title: titleFromWork(summary),
    year: yearOf(summary?.["publication-date"]),
    venue: value(summary?.["journal-title"]),
    type: String(summary?.type ?? "other"),
    doi: findDoi(summary),
    url: fallbackUrl(summary),
    authors: [],
    volume: "",
    issue: "",
    pages: "",
    publisher: "",
  };

  try {
    const full = await fetchApiItem("work", work.putCode, token);
    if (full) {
      const authors = authorsFromFullWork(full);
      if (authors.length > 0) work.authors = authors;
      work.url = work.url || fallbackUrl(full);
      work.doi = work.doi || findDoi(full);
    }
  } catch (error) {
    console.warn(`Could not retrieve full ORCID work ${work.putCode}: ${error.message}`);
  }

  if (work.doi) {
    try {
      const csl = await doiMetadata(work.doi);
      const cslAuthors = deduplicateAuthors(Array.isArray(csl?.author) ? csl.author : []);
      work = {
        ...work,
        title: firstString(csl?.title) || work.title,
        year: Number(csl?.issued?.["date-parts"]?.[0]?.[0]) || work.year,
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

  const key = work.doi ? work.doi : `orcid-put-code:${work.putCode}`;
  work = applyOverride(work, publicationOverrides[key]);
  work = applyOverride(work, cvOverrides[key]);
  if (!Array.isArray(work.authors) || work.authors.length === 0) {
    work.authors = [{ given: "Gabriel", family: "Frazer-McKee" }];
  }
  work.section = work.section || SECTION_BY_TYPE.get(work.type) || "Other scholarly outputs";
  return work;
}

function bibliographicLine(work) {
  const parts = [];
  const venue = work.venue || work.publisher;
  let container = venue ? `*${markdownText(venue)}*` : "";
  if (work.volume) container += `${container ? ", " : ""}${markdownText(work.volume)}`;
  if (work.issue) container += `(${markdownText(work.issue)})`;
  if (work.pages) container += `${container ? ", " : ""}${markdownText(work.pages)}`;
  if (container) parts.push(container);
  if (work.year) parts.push(String(work.year));
  if (work.doi) parts.push(`[DOI](<${doiUrl(work.doi)}>)`);
  return parts.join(" · ");
}

function renderWork(work) {
  const title = markdownText(work.title);
  const linkedTitle = work.url ? `**[${title}](<${work.url}>)**` : `**${title}**`;
  return `${linkedTitle}  \n${joinAuthors(work.authors)}  \n${bibliographicLine(work)}\n`;
}

function fundingTitle(item) {
  return value(item?.title?.title)
    || value(item?.["funding-title"]?.title)
    || "Untitled funding";
}

function amountText(amount) {
  const raw = value(amount) || value(amount?.value);
  const currency = String(amount?.["currency-code"] ?? amount?.currency ?? "").trim();
  if (!raw) return "";
  const numeric = Number(String(raw).replaceAll(",", ""));
  const formatted = Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(numeric)
    : raw;
  return [formatted, currency].filter(Boolean).join(" ");
}

function organizationName(item) {
  return value(item?.organization?.name);
}

async function buildFunding(summary, token, overrides) {
  let full = null;
  try {
    full = await fetchApiItem("funding", summary?.["put-code"], token);
  } catch (error) {
    console.warn(`Could not retrieve full ORCID funding ${summary?.["put-code"]}: ${error.message}`);
  }
  const source = full || summary;
  const identifier = findExternalId(source, ["grant_number", "grant-number", "proposal-id", "other-id"]);
  let item = {
    putCode: summary?.["put-code"],
    title: fundingTitle(source) || fundingTitle(summary),
    type: String(source?.type ?? summary?.type ?? "funding").replaceAll("-", " "),
    organization: organizationName(source) || organizationName(summary),
    amount: amountText(source?.amount),
    dates: formatDateRange(source?.["start-date"] ?? summary?.["start-date"], source?.["end-date"] ?? summary?.["end-date"]),
    identifier: value(identifier?.["external-id-value"]),
    url: fallbackUrl(source) || fallbackUrl(summary),
  };
  const key = `orcid-put-code:${item.putCode}`;
  item = { ...item, ...(overrides[key] ?? {}) };
  return item;
}

function renderFunding(item) {
  const title = markdownText(item.title);
  const linkedTitle = item.url ? `**[${title}](<${item.url}>)**` : `**${title}**`;
  const details = [item.organization, item.type, item.amount, item.dates]
    .filter(Boolean)
    .map(markdownText);
  if (item.identifier) details.push(`Award no. ${markdownText(item.identifier)}`);
  return `${linkedTitle}  \n${details.join(" · ")}\n`;
}

async function buildAffiliation(summary, kind, token, overrides) {
  let full = null;
  try {
    full = await fetchApiItem(kind, summary?.["put-code"], token);
  } catch (error) {
    console.warn(`Could not retrieve full ORCID ${kind} ${summary?.["put-code"]}: ${error.message}`);
  }
  const source = full || summary;
  let item = {
    putCode: summary?.["put-code"],
    title: value(source?.["role-title"]) || value(summary?.["role-title"]),
    department: value(source?.["department-name"]) || value(summary?.["department-name"]),
    organization: organizationName(source) || organizationName(summary),
    dates: formatDateRange(source?.["start-date"] ?? summary?.["start-date"], source?.["end-date"] ?? summary?.["end-date"]),
    url: fallbackUrl(source) || fallbackUrl(summary),
  };
  const key = `orcid-put-code:${item.putCode}`;
  item = { ...item, ...(overrides[key] ?? {}) };
  return item;
}

function renderDistinction(item) {
  const title = markdownText(item.title || "Award or distinction");
  const linked = item.url ? `**[${title}](<${item.url}>)**` : `**${title}**`;
  const details = [item.organization, item.department, item.dates].filter(Boolean).map(markdownText);
  return `${linked}${details.length ? `  \n${details.join(" · ")}` : ""}\n`;
}

function renderMembership(item) {
  const organization = markdownText(item.organization || "Professional association");
  const linked = item.url ? `**[${organization}](<${item.url}>)**` : `**${organization}**`;
  const details = [item.title || "Member", item.department, item.dates].filter(Boolean).map(markdownText);
  return `${linked}${details.length ? `  \n${details.join(" · ")}` : ""}\n`;
}

function sortDescendingByYear(items) {
  return [...items].sort((a, b) => {
    const yearA = Number(String(a.year ?? a.dates ?? "").match(/\d{4}/)?.[0] ?? 0);
    const yearB = Number(String(b.year ?? b.dates ?? "").match(/\d{4}/)?.[0] ?? 0);
    return yearB - yearA || String(a.title ?? a.organization).localeCompare(String(b.title ?? b.organization), "en", { sensitivity: "base" });
  });
}

function renderCv(works, funding, distinctions, memberships) {
  const output = ["# Publications", ""];
  const groupedWorks = new Map();
  for (const work of works) {
    if (!groupedWorks.has(work.section)) groupedWorks.set(work.section, []);
    groupedWorks.get(work.section).push(work);
  }
  for (const section of PUBLICATION_SECTION_ORDER) {
    const sectionWorks = groupedWorks.get(section);
    if (!sectionWorks?.length) continue;
    output.push(`## ${section}`, "");
    for (const work of sortDescendingByYear(sectionWorks)) {
      output.push(renderWork(work));
    }
  }

  if (funding.length > 0) {
    output.push("# Grants and funding", "");
    for (const item of sortDescendingByYear(funding)) output.push(renderFunding(item));
  }

  if (distinctions.length > 0) {
    output.push("# Awards and distinctions", "");
    for (const item of sortDescendingByYear(distinctions)) output.push(renderDistinction(item));
  }

  if (memberships.length > 0) {
    output.push("# Professional memberships", "");
    for (const item of [...memberships].sort((a, b) => String(a.organization).localeCompare(String(b.organization), "en", { sensitivity: "base" }))) {
      output.push(renderMembership(item));
    }
  }

  return `${output.join("\n").trim()}\n`;
}

async function writeOnlyIfChanged(path, content) {
  await Deno.mkdir(path.substring(0, path.lastIndexOf("/")), { recursive: true });
  let existing = "";
  try {
    existing = await Deno.readTextFile(path);
  } catch {
    // File does not exist yet.
  }
  if (existing === content) {
    console.log("CV ORCID sections are already current.");
    return;
  }
  await Deno.writeTextFile(path, content);
  console.log(`Updated ${path}.`);
}

try {
  const publicationOverrides = await readJsonIfExists(PUBLICATION_OVERRIDES_FILE, {});
  const cvOverrides = await readJsonIfExists(CV_OVERRIDES_FILE, {
    works: {}, funding: {}, distinctions: {}, memberships: {},
  });
  const token = await obtainAccessToken();
  const record = await fetchJson(ORCID_PROFILE_URL, {
    headers: { Accept: "application/json" },
  });
  const activities = record?.["activities-summary"] ?? {};

  const workGroups = activities?.works?.group ?? [];
  const workSummaries = workGroups.map((group) => preferredByDisplayIndex(group?.["work-summary"] ?? [])).filter(Boolean);
  const works = [];
  for (const summary of workSummaries) {
    works.push(await buildWork(summary, token, publicationOverrides, cvOverrides?.works ?? {}));
  }

  const fundingSummaries = collectSummaries(activities?.fundings, "funding-summary");
  const funding = [];
  for (const summary of fundingSummaries) {
    funding.push(await buildFunding(summary, token, cvOverrides?.funding ?? {}));
  }

  const distinctionSummaries = collectSummaries(activities?.distinctions, "distinction-summary");
  const distinctions = [];
  for (const summary of distinctionSummaries) {
    distinctions.push(await buildAffiliation(summary, "distinction", token, cvOverrides?.distinctions ?? {}));
  }

  const membershipSummaries = collectSummaries(activities?.memberships, "membership-summary");
  const memberships = [];
  for (const summary of membershipSummaries) {
    memberships.push(await buildAffiliation(summary, "membership", token, cvOverrides?.memberships ?? {}));
  }

  if (works.length === 0) throw new Error("No public ORCID works were found.");
  await writeOnlyIfChanged(OUTPUT_FILE, renderCv(works, funding, distinctions, memberships));
} catch (error) {
  if (await fileExists(OUTPUT_FILE)) {
    console.warn(`CV refresh failed; retaining the last generated fragment. ${error.message}`);
    Deno.exit(0);
  }
  console.error(`Could not generate the CV. ${error.message}`);
  Deno.exit(1);
}
