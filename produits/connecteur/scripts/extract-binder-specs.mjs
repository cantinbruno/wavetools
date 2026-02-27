/**
 * extract-binder-specs.mjs (CLEAN + FILTER FAMILLES + SECTIONS ROBUSTES)
 *
 * Objectif:
 * - Ne garder QUE les familles (M12-A, M8, etc.)
 * - Garder toutes leurs "variantes" => toutes les pages produit du sitemap qui matchent la famille
 * - JSON + image ont exactement le même nom: <REF_SLUG>.json / <REF_SLUG>.<ext>
 * - sections jamais vides si les données sont dans le HTML (fallback tables)
 *
 * Déps:
 *   npm i cheerio xml2js
 */

import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

const OUT_DIR = path.resolve("produits/connecteur/fiche");
const IMG_DIR = path.resolve("produits/connecteur/img");

// Réglages
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS || 0); // 0 = tout
const DELAY_MS = Number(process.env.DELAY_MS || 120);
const KEEP_OLD = (process.env.KEEP_OLD || "0") === "1";

// ✅ Liste des familles autorisées (ta 2e image)
// Tu peux enlever/ajouter des entrées ici.
const FAMILY_WHITELIST = [
  "M12-A",
  "RD24 Power",
  "M8",
  "M12-D",
  "M12-L",
  "M8-D",
  "M12-K",
  "M16 IP67",
  '7/8"'
];

const FAMILY_WHITELIST_LOWER = FAMILY_WHITELIST.map((f) =>
  f.toLowerCase().replace(/"/g, "")
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

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

/** Catégorie1 = segment après /produits/ */
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

/** ✅ Détecte famille via breadcrumb + texte page */
function detectFamily({ url, title, $ }) {
  // Breadcrumb visible sur ta capture : "Produits > ... > M12-A > ..."
  const breadcrumb = clean($(".breadcrumb, .breadcrumbs, nav[aria-label='breadcrumb']").first().text());
  const bodyText = clean($("body").text());

  const hay = `${url} ${title || ""} ${breadcrumb} ${bodyText}`
    .toLowerCase()
    .replace(/"/g, "");

  for (let i = 0; i < FAMILY_WHITELIST_LOWER.length; i++) {
    const token = FAMILY_WHITELIST_LOWER[i];
    if (hay.includes(token)) return FAMILY_WHITELIST[i];
  }
  return null;
}

/** Ref depuis sections (champ "Référence") */
function refFromSections(sections) {
  for (const kv of Object.values(sections || {})) {
    if (kv && kv["Référence"]) return kv["Référence"];
  }
  return null;
}

/** Ref depuis le texte (plusieurs formats possibles) */
function extractRefFromText($) {
  const txt = clean($("body").text());

  // 1) ex: 08 2679 000 001
  let m = txt.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/);
  if (m) return m[0];

  // 2) ex: 99 0530 24 04 (comme ta capture M12-A)
  m = txt.match(/\b\d{2}\s\d{4}\s\d{2}\s\d{2}\b/);
  if (m) return m[0];

  return null;
}

/** Ref depuis URL (fallback fiable) */
function extractRefFromUrl(productUrl) {
  // Supporte:
  // - 09-9792-30-05 (2-4-2-2)
  // - 99-0530-24-04 (2-4-2-2)
  // - 08-2679-000-001 (2-4-3-3)
  const m = productUrl.match(/\b(\d{2}-\d{4}-\d{2}-\d{2}|\d{2}-\d{4}-\d{3}-\d{3})\b/);
  if (!m) return null;
  return m[1].replace(/-/g, " ");
}

/**
 * Extraction sections accordéon binder si présent:
 * .accordion__header + table(.table--technicaldata)
 */
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

/**
 * ✅ Fallback robuste: récupère des tables "techniques" même si pas d'accordéon
 * et les met dans "Données techniques".
 */
function extractTechnicalTablesFallback($) {
  let merged = {};

  $("table").each((_, t) => {
    const kv = {};
    $(t)
      .find("tr")
      .each((_, tr) => {
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

    if (looksLikeSpecs && Object.keys(kv).length) {
      merged = { ...merged, ...kv };
    }
  });

  return Object.keys(merged).length ? { "Données techniques": merged } : {};
}

function mergeSections(a, b) {
  const out = { ...(a || {}) };
  for (const [sec, kv] of Object.entries(b || {})) {
    out[sec] = { ...(out[sec] || {}), ...(kv || {}) };
  }
  for (const [k, v] of Object.entries(out)) {
    if (!v || Object.keys(v).length === 0) delete out[k];
  }
  return out;
}

/** Image principale = 1er lien "Télécharger l’image JPG" */
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

  // fallback: 1ère balise img si aucun lien download
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
  if (MAX_PRODUCTS > 0) urls = urls.slice(0, MAX_PRODUCTS);
  console.log(`Produits à traiter (brut sitemap): ${urls.length}`);

  const indexItems = [];
  let kept = 0;
  let skipped = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] ${url}`);

    let html;
    try {
      html = await fetchText(url);
    } catch (e) {
      console.warn(`  ⚠️ Page inaccessible: ${e.message}`);
      skipped++;
      continue;
    }

    const $ = cheerio.load(html);

    const title = clean($("h1").first().text()) || null;
    const category1 = extractCategory1FromUrl(url);

    // ✅ Filtre familles (M12-A etc.)
    const family = detectFamily({ url, title, $ });
    if (!family) {
      console.log("  ⏭️ skip (hors whitelist familles)");
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    // ✅ Sections robustes: accordéon + fallback tables
    const secA = extractSectionsBinderAccordion($);
    const secB = extractTechnicalTablesFallback($);
    const sections = mergeSections(secA, secB);

    // ✅ REF: sections -> texte -> URL
    let ref = refFromSections(sections) || extractRefFromText($) || extractRefFromUrl(url);

    if (!ref) {
      console.warn("  ❌ Ref introuvable => skip pour rester propre/cohérent.");
      skipped++;
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

      try {
        await downloadToFile(mainImageUrl, imgDest);
        mainImageLocal = `produits/connecteur/img/${imgFilename}`;
      } catch (e) {
        console.warn(`  ⚠️ image non téléchargée: ${e.message}`);
      }
    }

    // ✅ JSON = même nom que ref
    const jsonFilename = `${refSlug}.json`;
    const jsonPath = path.join(OUT_DIR, jsonFilename);

    const data = {
      ref,
      title,
      url,
      category1,
      family,              // ✅ ex "M12-A"
      mainImage: mainImageLocal,
      sections
    };

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");

    indexItems.push({
      ref,
      title,
      url,
      category1,
      family,
      mainImage: mainImageLocal,
      file: `produits/connecteur/fiche/${jsonFilename}`
    });

    kept++;
    await sleep(DELAY_MS);
  }

  indexItems.sort((a, b) => String(a.ref ?? "").localeCompare(String(b.ref ?? ""), "fr"));

  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: indexItems.length,
        kept,
        skipped,
        families: FAMILY_WHITELIST,
        items: indexItems
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`✅ Terminé. Gardés: ${kept} | Skippés: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});