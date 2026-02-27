/**
 * extract-binder-specs.mjs
 * Binder (TYPO3) extractor - HTML accordion parser
 *
 * Sortie:
 *  - produits/connecteur/fiche/<REF>.json (ou hash si ref inconnue)
 *  - produits/connecteur/fiche/index.json
 *
 * Contenu:
 *  - ref, title, url
 *  - category1 (uniquement 1ère catégorie depuis l'URL)
 *  - mainImage (1ère image jpg utile trouvée sur la page)
 *  - sections (Caractéristiques/Matériaux/Classifications... selon la page)
 *
 * Nettoyage:
 *  - supprime les anciens *.json dans produits/connecteur/fiche à chaque run (sauf KEEP_OLD=1)
 *
 * Dépendances:
 *  npm i cheerio xml2js
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

// TON dossier de sortie
const OUT_DIR = path.resolve("produits/connecteur/fiche");

// Réglages (optionnels via env)
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS || 0); // 0 = tout
const DELAY_MS = Number(process.env.DELAY_MS || 120); // politesse
const KEEP_OLD = (process.env.KEEP_OLD || "0") === "1"; // 1 = ne pas supprimer les anciens JSON

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}

const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function slugRef(ref) {
  // "09 9767 00 04" => "09-9767-00-04"
  return clean(ref).replace(/\s+/g, "-");
}

function cleanupOutDirJson() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (KEEP_OLD) {
    console.log("KEEP_OLD=1 → on ne supprime pas les anciens JSON.");
    return;
  }

  console.log(`Nettoyage: suppression des anciens *.json dans ${OUT_DIR}`);
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.toLowerCase().endsWith(".json")) {
      fs.unlinkSync(path.join(OUT_DIR, f));
    }
  }
}

async function getAllProductUrlsFromSitemap() {
  const indexXml = await fetchText(SITEMAP_INDEX);
  const indexObj = await parseStringPromise(indexXml);

  const sitemapUrls = asArray(indexObj?.sitemapindex?.sitemap)
    .map((s) => s.loc?.[0])
    .filter(Boolean);

  const productSitemaps = sitemapUrls.filter((u) => u.includes("sitemap=products"));
  if (!productSitemaps.length) {
    throw new Error("Aucun sitemap=products trouvé dans l’index.");
  }

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

/**
 * Catégorie 1 = premier segment après /produits/
 * Ex:
 *  /fr/produits/connecteurs-subminiatures/connecteur-encliquetable-ip40/.... -> connecteurs-subminiatures
 */
function extractCategory1FromUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    const parts = u.pathname.split("/").filter(Boolean); // ["fr","produits","connecteurs-subminiatures", ...]
    const i = parts.indexOf("produits");
    if (i === -1) return null;
    return parts[i + 1] ?? null;
  } catch {
    return null;
  }
}

function extractRefRegex($) {
  // Format souvent vu: "08 2679 000 001"
  const bodyText = clean($("body").text());
  const m = bodyText.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/);
  return m ? m[0] : null;
}

/**
 * ✅ Extraction binder:
 * sections dans un accordéon:
 *   .accordion__header = titre
 *   table.table--technicaldata = lignes clé/valeur
 */
function extractSectionsBinderAccordion($) {
  const sections = {};

  $(".accordion__header").each((_, header) => {
    const title = clean($(header).text()).replace(/\b(Plus|less)\b/gi, "").trim();
    if (!title) return;

    const container =
      $(header).closest(".accordion__item").length
        ? $(header).closest(".accordion__item")
        : $(header).parent();

    const table =
      container.find("table.table--technicaldata").first().length
        ? container.find("table.table--technicaldata").first()
        : container.find("table").first();

    if (!table || !table.length) return;

    const kv = {};
    table.find("tr").each((_, tr) => {
      const cells = $(tr)
        .find("th, td")
        .toArray()
        .map((el) => clean($(el).text()))
        .filter(Boolean);

      if (cells.length >= 2) {
        const key = cells[0];
        const val = cells.slice(1).join(" ");
        kv[key] = val;
      }
    });

    if (Object.keys(kv).length) {
      sections[title] = kv;
    }
  });

  return sections;
}

/**
 * Fallback: si une page n'a pas l'accordéon standard, on tente de lire toutes les tables
 * en les mettant sous une section "Données techniques".
 */
function extractSectionsGenericTables($) {
  const kv = {};

  $("table").each((_, t) => {
    const table = $(t);
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
  });

  return Object.keys(kv).length ? { "Données techniques": kv } : {};
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

/**
 * Image principale:
 * binder propose des liens "Télécharger l’image JPG - ..."
 * On prend la première URL .jpg trouvée correspondant à ce pattern.
 */
function extractMainImage($, pageUrl) {
  let found = null;

  $("a[href]").each((_, a) => {
    if (found) return;

    const href = $(a).attr("href");
    if (!href) return;

    const text = clean($(a).text());
    const abs = href.startsWith("http") ? href : new URL(href, pageUrl).toString();

    // Pattern fiable sur binder: "Télécharger l’image JPG" + lien .jpg
    if (/télécharger l’image/i.test(text) && /\.jpe?g(\?.*)?$/i.test(abs)) {
      found = abs;
    }
  });

  // Fallback: si pas de lien "Télécharger l’image", on tente img src (souvent thumbnail)
  if (!found) {
    const img = $("img").first();
    const src = img.attr("src");
    if (src) found = src.startsWith("http") ? src : new URL(src, pageUrl).toString();
  }

  return found;
}

/**
 * Fallback ref depuis les sections:
 * Dans ton exemple, "Référence" est dans les KV.
 */
function fallbackRefFromSections(sections) {
  for (const kv of Object.values(sections || {})) {
    if (kv && typeof kv === "object" && kv["Référence"]) return kv["Référence"];
  }
  return null;
}

async function main() {
  cleanupOutDirJson();

  console.log("Lecture du sitemap products…");
  let productUrls = await getAllProductUrlsFromSitemap();
  if (MAX_PRODUCTS > 0) productUrls = productUrls.slice(0, MAX_PRODUCTS);
  console.log(`URLs produits à traiter : ${productUrls.length}`);

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
    const mainImage = extractMainImage($, url);

    // sections
    const secA = extractSectionsBinderAccordion($);
    const secB = Object.keys(secA).length ? {} : extractSectionsGenericTables($);
    let sections = mergeSections(secA, secB);

    // ref
    let ref = extractRefRegex($);
    if (!ref) ref = fallbackRefFromSections(sections);

    if (!ref) console.warn("  ⚠️ Référence non trouvée (nom de fichier = hash).");
    if (Object.keys(sections).length === 0) console.warn("  ⚠️ Aucune section détectée (page atypique).");
    if (!mainImage) console.warn("  ⚠️ Aucune image principale détectée.");

    const data = {
      ref,
      title,
      url,
      category1,
      mainImage,
      sections,
    };

    const fileBase = ref ? slugRef(ref) : sha1(url);
    const outFile = path.join(OUT_DIR, `${fileBase}.json`);
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), "utf-8");

    indexItems.push({
      ref,
      title,
      url,
      category1,
      mainImage,
      file: `produits/connecteur/fiche/${path.basename(outFile)}`,
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

  console.log(`✅ Terminé. JSON produits: ${indexItems.length}`);
  console.log(`📁 Sortie: ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});