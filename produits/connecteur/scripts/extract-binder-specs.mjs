/**
 * extract-binder-specs.mjs (clean & coherent)
 * - JSON + image ont exactement le même nom: <REF_SLUG>.(json|jpg)
 * - REF récupérée dans cet ordre:
 *   1) "Référence" dans les sections
 *   2) format avec espaces dans le texte (08 2679 000 001)
 *   3) format dans l'URL (09-9792-30-05 ou 08-2679-000-001)
 *
 * Déps: npm i cheerio xml2js
 */

import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

const OUT_DIR = path.resolve("produits/connecteur/fiche");
const IMG_DIR = path.resolve("produits/connecteur/img");

const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS || 0);
const DELAY_MS = Number(process.env.DELAY_MS || 120);
const KEEP_OLD = (process.env.KEEP_OLD || "0") === "1";

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
  // "09 9792 30 05" -> "09-9792-30-05"
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

/** 1) Ref dans le HTML texte (format espaces) */
function extractRefFromTextRegex($) {
  const bodyText = clean($("body").text());
  const m = bodyText.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/); // ex 08 2679 000 001
  return m ? m[0] : null;
}

/** 2) Ref depuis URL (fiable) */
function extractRefFromUrl(productUrl) {
  // Supporte:
  // - 09-9792-30-05 (2-4-2-2)
  // - 08-2679-000-001 (2-4-3-3)
  const m = productUrl.match(/\b(\d{2}-\d{4}-\d{2}-\d{2}|\d{2}-\d{4}-\d{3}-\d{3})\b/);
  if (!m) return null;
  return m[1].replace(/-/g, " ");
}

/** Extraction sections binder (accordéon) */
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

      if (cells.length >= 2) {
        kv[cells[0]] = cells.slice(1).join(" ");
      }
    });

    if (Object.keys(kv).length) sections[title] = kv;
  });

  return sections;
}

/** fallback ref depuis sections ("Référence") */
function refFromSections(sections) {
  for (const kv of Object.values(sections || {})) {
    if (kv && kv["Référence"]) return kv["Référence"];
  }
  return null;
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

    if (/télécharger l’image/i.test(text) && /\.jpe?g(\?.*)?$/i.test(abs)) {
      found = abs;
    }
  });

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
  let productUrls = await getAllProductUrlsFromSitemap();
  if (MAX_PRODUCTS > 0) productUrls = productUrls.slice(0, MAX_PRODUCTS);
  console.log(`Produits à traiter: ${productUrls.length}`);

  const indexItems = [];

  for (let i = 0; i < productUrls.length; i++) {
    const url = productUrls[i];
    console.log(`[${i + 1}/${productUrls.length}] ${url}`);

    let html;
    try {
      html = await fetchText(url);
    } catch (e) {
      console.warn(`  ⚠️ Page inaccessible: ${e.message}`);
      continue;
    }

    const $ = cheerio.load(html);

    const title = clean($("h1").first().text()) || null;
    const category1 = extractCategory1FromUrl(url);

    const sections = extractSectionsBinderAccordion($);

    // ✅ REF: priorité sections -> texte -> URL
    let ref =
      refFromSections(sections) ||
      extractRefFromTextRegex($) ||
      extractRefFromUrl(url);

    if (!ref) {
      // Là ça devient vraiment rare. On préfère SKIP plutôt que créer un hash (tu veux du propre/cohérent).
      console.warn("  ❌ Référence introuvable => produit ignoré pour rester cohérent.");
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
        console.warn(`  ⚠️ Image non téléchargée: ${e.message}`);
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
      mainImage: mainImageLocal, // chemin local (ou null)
      sections,
    };

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");

    indexItems.push({
      ref,
      title,
      url,
      category1,
      mainImage: mainImageLocal,
      file: `produits/connecteur/fiche/${jsonFilename}`,
    });

    await sleep(DELAY_MS);
  }

  indexItems.sort((a, b) => String(a.ref ?? "").localeCompare(String(b.ref ?? ""), "fr"));

  const indexJson = {
    generatedAt: new Date().toISOString(),
    count: indexItems.length,
    items: indexItems,
  };

  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(indexJson, null, 2), "utf-8");

  console.log(`✅ Terminé. Produits exportés: ${indexItems.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});