/**
 * extract-binder-specs.mjs (binder accordion parser)
 * - sitemap products -> urls produit
 * - extrait ref/titre + sections "Caractéristiques générales / Matériaux / Classifications" etc.
 * - écrit 1 JSON par produit + index.json
 * - supprime les anciens .json dans produits/connecteur/fiche à chaque exécution
 *
 * Déps: npm i cheerio xml2js
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

// SORTIE (ton arborescence)
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
  return clean(ref).replace(/\s+/g, "-"); // "08 2679..." -> "08-2679..."
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

function extractRef($) {
  // binder affiche souvent "08 2679 000 001" quelque part sur la page
  const bodyText = clean($("body").text());
  const m = bodyText.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/);
  return m ? m[0] : null;
}

/**
 * ✅ Extraction spéciale binder :
 * Les sections sont dans un accordéon :
 *   <div class="accordion__header">Caractéristiques générales</div>
 *   ... <table class="table--technicaldata"> ... </table>
 */
function extractSectionsBinderAccordion($) {
  const sections = {};

  // Les tables de specs ont souvent la classe "table--technicaldata"
  // On parcourt chaque header et on récupère le tableau dans le même "item"
  $(".accordion__header").each((_, header) => {
    const title = clean($(header).text());
    if (!title) return;

    // On remonte à un conteneur raisonnable (accordéon item) puis on cherche la table dedans
    const container =
      $(header).closest(".accordion__item").length
        ? $(header).closest(".accordion__item")
        : $(header).closest("[data-collapse='technicaldata']").length
          ? $(header).closest("[data-collapse='technicaldata']")
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
 * Fallback : au cas où certaines pages ont des tables en dehors de l'accordéon.
 */
function extractSectionsGenericTables($) {
  const sections = {};

  // si on a des tables verticales "datatable", on les lit et on les met sous une section générique
  $("table").each((_, t) => {
    const table = $(t);
    const kv = {};

    table.find("tr").each((_, tr) => {
      const cells = $(tr)
        .find("th, td")
        .toArray()
        .map((el) => clean($(el).text()))
        .filter(Boolean);
      if (cells.length >= 2) kv[cells[0]] = cells.slice(1).join(" ");
    });

    if (Object.keys(kv).length) {
      // évite de créer 10 sections "Table"
      const name = "Données techniques";
      sections[name] = { ...(sections[name] || {}), ...kv };
    }
  });

  return sections;
}

function mergeSections(a, b) {
  const out = { ...(a || {}) };
  for (const [sec, kv] of Object.entries(b || {})) {
    out[sec] = { ...(out[sec] || {}), ...(kv || {}) };
  }
  // nettoie les sections vides
  for (const [k, v] of Object.entries(out)) {
    if (!v || Object.keys(v).length === 0) delete out[k];
  }
  return out;
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

    const ref = extractRef($);
    const title = clean($("h1").first().text()) || null;

    // ✅ binder accordion
    const sec1 = extractSectionsBinderAccordion($);
    // fallback
    const sec2 = Object.keys(sec1).length ? {} : extractSectionsGenericTables($);

    const sections = mergeSections(sec1, sec2);

    if (Object.keys(sections).length === 0) {
      console.warn("  ⚠️ Aucune section détectée (page atypique ou contenu non présent dans le HTML).");
    }

    const data = { ref, title, url, sections };

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