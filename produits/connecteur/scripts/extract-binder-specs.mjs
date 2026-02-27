/**
 * extract-binder-specs.mjs
 * One-shot extractor:
 * - lit le sitemap products (TYPO3)
 * - visite chaque page produit
 * - extrait les tableaux "Caractéristiques / Matériaux / Classifications" (et autres sections similaires)
 * - écrit 1 JSON par produit dans produits/connecteur/fiche/
 * - écrit un index.json (liste des produits) dans le même dossier
 *
 * IMPORTANT :
 * - Script prévu pour tourner en local OU GitHub Actions.
 * - Ne télécharge pas de PDF/CAO/etc (on ignore volontairement les pièces jointes).
 *
 * Dépendances:
 *   npm i cheerio xml2js
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

// Où écrire les JSON (adapté à TON arborescence)
const OUT_DIR = path.resolve("produits/connecteur/fiche");

// Réglages (optionnels via variables d’environnement)
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS || 0); // 0 = tout
const DELAY_MS = Number(process.env.DELAY_MS || 200); // politesse
const KEEP_OLD = (process.env.KEEP_OLD || "0") === "1"; // si 1 -> ne supprime pas les anciens json
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
  // "08 2679 000 001" -> "08-2679-000-001"
  return clean(ref).replace(/\s+/g, "-");
}

/**
 * Supprime UNIQUEMENT les .json du dossier OUT_DIR
 * (pour repartir proprement à chaque exécution).
 */
function cleanupOutDirJson() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (KEEP_OLD) {
    console.log("KEEP_OLD=1 → on ne supprime pas les anciens JSON.");
    return;
  }

  console.log(`Nettoyage: suppression des anciens *.json dans ${OUT_DIR}`);
  const files = fs.readdirSync(OUT_DIR);
  for (const f of files) {
    if (f.toLowerCase().endsWith(".json")) {
      fs.unlinkSync(path.join(OUT_DIR, f));
    }
  }
}

/**
 * Récupère la liste de sitemaps "products" depuis l'index TYPO3.
 * Puis extrait toutes les URLs produit (loc).
 */
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

  // dédup
  return Array.from(new Set(urls));
}

/**
 * Essaie d’extraire la référence produit dans le texte de page.
 * binder affiche souvent "08 2679 000 001" (avec espaces).
 */
function extractRef($) {
  const bodyText = clean($("body").text());
  const m = bodyText.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/);
  return m ? m[0] : null;
}

/**
 * Extrait des sections de specs sous forme:
 *   { "Caractéristiques générales": { "clé": "valeur", ... }, ... }
 *
 * On couvre 2 cas:
 * - tables <table><tr><td>clé</td><td>valeur</td></tr>...
 * - "table-like" en div (si jamais)
 *
 * NOTE : sans le HTML exact, on reste volontairement robuste + heuristique.
 */
function extractSections($) {
  const sections = {};

  // --- 1) Cas "table" : un titre (h2/h3/h4) suivi d'un tableau
  const headings = $("h2, h3, h4").toArray();
  for (const h of headings) {
    const title = clean($(h).text());
    if (!title) continue;

    // Cherche un tableau après le titre ou dans le même bloc
    let table = $(h).nextAll("table").first();
    if (!table.length) table = $(h).parent().find("table").first();
    if (!table.length) continue;

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
  }

  // --- 2) Cas "pas de table" : lignes label/value (fallback)
  if (Object.keys(sections).length === 0) {
    // Quelques conteneurs probables
    const containers = $(".product, .product-detail, .productdetails, .productDetails, main").toArray();

    for (const c of containers) {
      const $c = $(c);

      // bloc section : titre + rows
      $c.find("section, .section, .accordion-item, .accordion").each((_, block) => {
        const $b = $(block);
        const title = clean($b.find("h2, h3, h4").first().text());
        if (!title) return;

        const kv = {};

        // patterns classiques label/value
        $b.find(".row, .spec-row, .table-row, .dl-row").each((_, row) => {
          const $r = $(row);
          const key = clean($r.find(".label, .key, dt, .col-1, .left").first().text());
          const val = clean($r.find(".value, .val, dd, .col-2, .right").first().text());
          if (key && val) kv[key] = val;
        });

        if (Object.keys(kv).length) sections[title] = kv;
      });
    }
  }

  // Dédup / nettoyage : supprimer sections vides
  for (const [k, v] of Object.entries(sections)) {
    if (!v || Object.keys(v).length === 0) delete sections[k];
  }

  return sections;
}

async function main() {
  // 0) Nettoyage
  cleanupOutDirJson();

  // 1) URLs produits depuis sitemap
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

    const ref = extractRef($);
    const title = clean($("h1").first().text()) || null;

    const sections = extractSections($);

    // Si aucune section, on garde quand même une fiche (pour debug)
    if (Object.keys(sections).length === 0) {
      console.warn("  ⚠️ Aucune section de caractéristiques détectée sur cette page (HTML possiblement dynamique).");
    }

    const data = {
      ref,
      title,
      url,
      sections,
    };

    const fileBase = ref ? slugRef(ref) : sha1(url);
    const outFile = path.join(OUT_DIR, `${fileBase}.json`);
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), "utf-8");

    indexItems.push({
      ref,
      title,
      url,
      file: `produits/connecteur/fiche/${path.basename(outFile)}`,
    });

    await sleep(DELAY_MS);
  }

  // 3) Écrire index.json (liste)
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