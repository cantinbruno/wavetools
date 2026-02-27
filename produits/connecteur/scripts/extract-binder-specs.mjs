/**
 * extract-binder-specs.mjs (version robuste "accordéons/texte")
 * - sitemap products -> urls produit
 * - extrait ref/titre + sections Caractéristiques/Matériaux/Classifications (et autres)
 * - écrit 1 JSON par produit + index.json
 * - SUPPRIME tous les anciens .json dans produits/connecteur/fiche à chaque exécution
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

// Sortie (TON arborescence)
const OUT_DIR = path.resolve("produits/connecteur/fiche");

// Réglages
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS || 0); // 0 = tout
const DELAY_MS = Number(process.env.DELAY_MS || 150); // un peu plus rapide
const KEEP_OLD = (process.env.KEEP_OLD || "0") === "1"; // 1 -> ne supprime pas les anciens json

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

/** Nettoyage: supprime uniquement les .json dans OUT_DIR */
function cleanupOutDirJson() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (KEEP_OLD) {
    console.log("KEEP_OLD=1 → on ne supprime pas les anciens JSON.");
    return;
  }

  console.log(`Nettoyage: suppression des anciens *.json dans ${OUT_DIR}`);
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.toLowerCase().endsWith(".json")) fs.unlinkSync(path.join(OUT_DIR, f));
  }
}

/** Récupère toutes les URLs produit depuis les sitemaps paginés */
async function getAllProductUrlsFromSitemap() {
  const indexXml = await fetchText(SITEMAP_INDEX);
  const indexObj = await parseStringPromise(indexXml);

  const sitemapUrls = asArray(indexObj?.sitemapindex?.sitemap)
    .map((s) => s.loc?.[0])
    .filter(Boolean);

  const productSitemaps = sitemapUrls.filter((u) => u.includes("sitemap=products"));
  if (!productSitemaps.length) throw new Error("Aucun sitemap=products trouvé dans l’index.");

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

/** Référence binder typique: "08 2679 000 001" */
function extractRefFromText(text) {
  const m = text.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/);
  return m ? m[0] : null;
}

/**
 * Convertit HTML -> texte AVEC retours à la ligne (robuste quand pas de <table>)
 * On force des \n sur des tags "bloc" puis on strip.
 */
function htmlToTextWithLines(html) {
  if (!html) return "";

  // enlever scripts/styles vite fait
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  // retours ligne sur tags de bloc et br
  html = html.replace(/<br\s*\/?>/gi, "\n");
  html = html.replace(/<\/(div|p|li|tr|h1|h2|h3|h4|section|article|header|footer|table|ul|ol)>/gi, "\n");

  // strip tags
  html = html.replace(/<[^>]+>/g, " ");

  // normaliser espaces
  html = html.replace(/\r/g, "");
  html = html.replace(/[ \t]+/g, " ");
  // rétablir lignes propres
  html = html.replace(/ *\n+ */g, "\n");
  return html.trim();
}

/**
 * Parse sections depuis texte :
 * Repère un titre de section, puis lit les lignes "clé  valeur"
 * jusqu'au prochain titre.
 */
function parseSectionsFromText(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Titres possibles (FR). Tu peux en ajouter si tu vois d’autres sections.
  const knownTitles = new Set([
    "Caractéristiques générales",
    "Caractéristiques",
    "Matériaux",
    "Classifications",
    "Classification",
    "Security notices",
    "Indications de sécurité",
  ]);

  // Heuristique : certaines pages ont "Plus less" collé au titre
  function normalizeTitle(line) {
    return line.replace(/\b(Plus|less)\b/gi, "").trim();
  }

  const sections = {};
  let currentTitle = null;

  // Une ligne KV binder ressemble souvent à: "Poids (g)  34.89"
  // On split sur 2+ espaces.
  function tryParseKV(line) {
    const parts = line.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const key = parts[0];
      const val = parts.slice(1).join(" ");
      // évite les faux positifs trop courts
      if (key.length >= 2 && val.length >= 1) return [key, val];
    }
    return null;
  }

  for (const raw of lines) {
    const titleCand = normalizeTitle(raw);

    // Si la ligne est un titre connu ou ressemble à un titre
    if (knownTitles.has(titleCand)) {
      currentTitle = titleCand;
      if (!sections[currentTitle]) sections[currentTitle] = {};
      continue;
    }

    // Détection "souple" des titres : lignes courtes sans chiffres, souvent capitalisées
    if (!currentTitle) {
      // rien
    }

    if (currentTitle) {
      const kv = tryParseKV(raw);
      if (kv) {
        const [k, v] = kv;
        sections[currentTitle][k] = v;
      } else {
        // certaines pages mettent "Référence  08..." juste après breadcrumb, sans titre
        // on ignore les lignes non kv.
      }
    }
  }

  // Supprimer sections vides
  for (const [k, v] of Object.entries(sections)) {
    if (!v || Object.keys(v).length === 0) delete sections[k];
  }

  return sections;
}

/**
 * Extraction finale :
 * - tente d’abord parse via texte "main" (le plus fiable ici)
 * - fallback sur body
 */
function extractProductData(html, url) {
  const $ = cheerio.load(html);

  const title = clean($("h1").first().text()) || null;

  // texte avec lignes : on privilégie <main> si présent
  const mainHtml = $("main").length ? $("main").html() : null;
  const bodyHtml = $("body").html();

  const textMain = htmlToTextWithLines(mainHtml || "");
  const textBody = htmlToTextWithLines(bodyHtml || "");

  const ref = extractRefFromText(textMain) || extractRefFromText(textBody);

  // sections depuis texte
  let sections = parseSectionsFromText(textMain);
  if (Object.keys(sections).length === 0) sections = parseSectionsFromText(textBody);

  return { ref, title, url, sections };
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

    const data = extractProductData(html, url);

    if (!data.ref) console.warn("  ⚠️ Référence non trouvée (fallback hash).");
    if (Object.keys(data.sections || {}).length === 0) {
      console.warn("  ⚠️ Aucune section détectée (regarde la page: structure atypique).");
    }

    const fileBase = data.ref ? slugRef(data.ref) : sha1(url);
    const outFile = path.join(OUT_DIR, `${fileBase}.json`);
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), "utf-8");

    indexItems.push({
      ref: data.ref,
      title: data.title,
      url: data.url,
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