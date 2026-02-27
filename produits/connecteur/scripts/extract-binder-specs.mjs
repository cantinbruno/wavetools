import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

const OUT_DIR = path.resolve("produits/connecteur/fiche");
const IMG_DIR = path.resolve("produits/connecteur/img");

const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS || 0); // 0 = tout
const DELAY_MS = Number(process.env.DELAY_MS || 120);
const KEEP_OLD = (process.env.KEEP_OLD || "0") === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Image HTTP ${res.status} on ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

function slugRef(ref) {
  // "99 0530 24 04" -> "99-0530-24-04"
  // "08 2679 000 001" -> "08-2679-000-001"
  return clean(ref).replace(/\s+/g, "-");
}

function ensureDirsAndCleanup() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });

  if (KEEP_OLD) {
    console.log("KEEP_OLD=1 -> pas de nettoyage.");
    return;
  }

  console.log("Nettoyage: suppression anciens JSON + images…");
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.toLowerCase().endsWith(".json")) fs.unlinkSync(path.join(OUT_DIR, f));
  }
  for (const f of fs.readdirSync(IMG_DIR)) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(f)) fs.unlinkSync(path.join(IMG_DIR, f));
  }
}

/**
 * ✅ UNIQUEMENT les familles que tu as données (filtrage AVANT crawl)
 * On stocke: prefix -> family label
 */
const FAMILY_PREFIXES = [
  { family: "M12-A", prefix: "https://www.binder-connector.com/fr/produits/technologie-dautomatisation/m12-a/" },
  { family: "RD24 Power", prefix: "https://www.binder-connector.com/fr/produits/power/rd24-power/" },
  { family: "M8", prefix: "https://www.binder-connector.com/fr/produits/technologie-dautomatisation/m8/" },
  { family: "M12-D", prefix: "https://www.binder-connector.com/fr/produits/connectique-dautomatisme-speciaux/m12-d/" },
  { family: "M12-L", prefix: "https://www.binder-connector.com/fr/produits/connecteurs-dautomatisme-tension-et-alimentation/m12-l/" },
  { family: "M8-D", prefix: "https://www.binder-connector.com/fr/produits/connectique-dautomatisme-speciaux/m8-d/" },
  { family: "M12-K", prefix: "https://www.binder-connector.com/fr/produits/connecteurs-dautomatisme-tension-et-alimentation/m12-k/" },
  { family: "M16 IP67", prefix: "https://www.binder-connector.com/fr/produits/miniatures/m16-ip67/" },
  { family: '7/8"', prefix: "https://www.binder-connector.com/fr/produits/connecteurs-dautomatisme-tension-et-alimentation/7-8/" }
];

// normalisation (au cas où)
for (const p of FAMILY_PREFIXES) {
  if (!p.prefix.endsWith("/")) p.prefix += "/";
}

function getFamilyFromUrl(url) {
  for (const p of FAMILY_PREFIXES) {
    if (url.startsWith(p.prefix)) return p.family;
  }
  return null;
}

function filterUrlsByPrefixes(urls) {
  return urls.filter((u) => getFamilyFromUrl(u));
}

async function getAllProductUrlsFromSitemap() {
  const indexXml = await fetchText(SITEMAP_INDEX);
  const indexObj = await parseStringPromise(indexXml);

  const sitemapUrls = asArray(indexObj?.sitemapindex?.sitemap)
    .map((s) => s.loc?.[0])
    .filter(Boolean);

  const productSitemaps = sitemapUrls.filter((u) => u.includes("sitemap=products"));
  if (!productSitemaps.length) throw new Error("Aucun sitemap=products trouvé.");

  const urls = [];
  for (const sm of productSitemaps) {
    const xml = await fetchText(sm);
    const obj = await parseStringPromise(xml);
    const locs = asArray(obj?.urlset?.url).map((u) => u.loc?.[0]).filter(Boolean);
    urls.push(...locs);
    await sleep(DELAY_MS);
  }

  return Array.from(new Set(urls));
}

function extractCategory1FromUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("produits");
    return i !== -1 ? parts[i + 1] ?? null : null;
  } catch {
    return null;
  }
}

/** Ref depuis URL */
function extractRefFromUrl(productUrl) {
  const m = productUrl.match(/\b(\d{2}-\d{4}-\d{2}-\d{2}|\d{2}-\d{4}-\d{3}-\d{3})\b/);
  return m ? m[1].replace(/-/g, " ") : null;
}

/** Ref depuis texte (plusieurs formats) */
function extractRefFromText($) {
  const txt = clean($("body").text());

  // ex: 08 2679 000 001
  let m = txt.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/);
  if (m) return m[0];

  // ex: 99 0530 24 04 (M12-A)
  m = txt.match(/\b\d{2}\s\d{4}\s\d{2}\s\d{2}\b/);
  if (m) return m[0];

  return null;
}

/** Extraction accordéon binder si présent */
function extractSectionsBinderAccordion($) {
  const sections = {};

  $(".accordion__header").each((_, header) => {
    const title = clean($(header).text()).replace(/\b(Plus|less)\b/gi, "").trim();
    if (!title) return;

    const container = $(header).closest(".accordion__item").length
      ? $(header).closest(".accordion__item")
      : $(header).parent();

    const table = container.find("table.table--technicaldata").first().length
      ? container.find("table.table--technicaldata").first()
      : container.find("table").first();

    if (!table.length) return;

    const kv = {};
    table.find("tr").each((_, tr) => {
      const cells = $(tr)
        .find("th, td")
        .toArray()
        .map((el) => clean($(el).text()))
        .filter(Boolean);

      if (cells.length >= 2) kv[cells[0]] = cells.slice(1).join(" ");
    });

    if (Object.keys(kv).length) sections[title] = kv;
  });

  return sections;
}

/** Fallback robuste: tables techniques */
function extractTechnicalTablesFallback($) {
  let merged = {};

  $("table").each((_, t) => {
    const kv = {};
    $(t).find("tr").each((_, tr) => {
      const cells = $(tr)
        .find("th, td")
        .toArray()
        .map((el) => clean($(el).text()))
        .filter(Boolean);

      if (cells.length >= 2) kv[cells[0]] = cells.slice(1).join(" ");
    });

    const keys = Object.keys(kv).join(" ").toLowerCase();
    const looksLikeSpecs =
      keys.includes("référence") ||
      keys.includes("indice de protection") ||
      keys.includes("tension") ||
      keys.includes("courant") ||
      keys.includes("poids") ||
      keys.includes("matériau") ||
      keys.includes("etim") ||
      keys.includes("ecl@ss");

    if (looksLikeSpecs && Object.keys(kv).length) merged = { ...merged, ...kv };
  });

  return Object.keys(merged).length ? { "Données techniques": merged } : {};
}

function mergeSections(a, b) {
  const out = { ...(a || {}) };
  for (const [sec, kv] of Object.entries(b || {})) out[sec] = { ...(out[sec] || {}), ...(kv || {}) };
  for (const [k, v] of Object.entries(out)) if (!v || Object.keys(v).length === 0) delete out[k];
  return out;
}

function refFromSections(sections) {
  for (const kv of Object.values(sections || {})) {
    if (kv && kv["Référence"]) return kv["Référence"];
  }
  return null;
}

/** Image principale: lien "Télécharger l’image" */
function extractMainImageUrl($, pageUrl) {
  let found = null;

  $("a[href]").each((_, a) => {
    if (found) return;

    const href = $(a).attr("href");
    if (!href) return;

    const text = clean($(a).text());
    const abs = href.startsWith("http") ? href : new URL(href, pageUrl).toString();

    if (/télécharger l’image/i.test(text) && /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(abs)) {
      found = abs;
    }
  });

  // fallback: première img
  if (!found) {
    const src = $("img").first().attr("src");
    if (src) found = src.startsWith("http") ? src : new URL(src, pageUrl).toString();
  }

  return found;
}

function getImageExtensionFromUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (p.endsWith(".jpeg")) return ".jpeg";
    if (p.endsWith(".jpg")) return ".jpg";
    if (p.endsWith(".png")) return ".png";
    if (p.endsWith(".webp")) return ".webp";
  } catch {}
  return ".jpg";
}

async function main() {
  ensureDirsAndCleanup();

  console.log("Lecture sitemap products…");
  let urls = await getAllProductUrlsFromSitemap();
  console.log(`Produits sitemap (total): ${urls.length}`);

  // ✅ FILTRE AVANT CRAWL
  urls = filterUrlsByPrefixes(urls);
  console.log(`Produits après filtre familles: ${urls.length}`);

  if (MAX_PRODUCTS > 0) urls = urls.slice(0, MAX_PRODUCTS);

  const indexItems = [];
  let skippedNoRef = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const family = getFamilyFromUrl(url); // garanti non-null ici
    console.log(`[${i + 1}/${urls.length}] [${family}] ${url}`);

    const html = await fetchText(url);
    const $ = cheerio.load(html);

    const title = clean($("h1").first().text()) || null;
    const category1 = extractCategory1FromUrl(url);

    const secA = extractSectionsBinderAccordion($);
    const secB = extractTechnicalTablesFallback($);
    const sections = mergeSections(secA, secB);

    // ✅ ref: sections -> texte -> url
    let ref = refFromSections(sections) || extractRefFromText($) || extractRefFromUrl(url);
    if (!ref) {
      console.warn("  ❌ Ref introuvable => skip (pour rester propre/cohérent)");
      skippedNoRef++;
      await sleep(DELAY_MS);
      continue;
    }

    const refSlug = slugRef(ref);

    // ✅ image
    let mainImageLocal = null;
    const mainImageUrl = extractMainImageUrl($, url);
    if (mainImageUrl) {
      const ext = getImageExtensionFromUrl(mainImageUrl);
      const imgFilename = `${refSlug}${ext}`;
      const imgDest = path.join(IMG_DIR, imgFilename);
      await downloadToFile(mainImageUrl, imgDest);
      mainImageLocal = `produits/connecteur/img/${imgFilename}`;
    }

    // ✅ JSON = même nom que ref
    const jsonFilename = `${refSlug}.json`;
    const jsonPath = path.join(OUT_DIR, jsonFilename);

    const data = {
      ref,
      title,
      url,
      family,
      category1,
      mainImage: mainImageLocal,
      sections
    };

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");

    indexItems.push({
      ref,
      title,
      url,
      family,
      category1,
      mainImage: mainImageLocal,
      file: `produits/connecteur/fiche/${jsonFilename}`
    });

    await sleep(DELAY_MS);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: indexItems.length,
        skippedNoRef,
        families: FAMILY_PREFIXES.map((x) => x.family),
        items: indexItems
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`✅ Terminé. Produits exportés: ${indexItems.length} | noRef skipped: ${skippedNoRef}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});