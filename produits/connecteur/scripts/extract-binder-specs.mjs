#!/usr/bin/env node
/**
 * binder_groups_no_contactsDisponibles.mjs
 *
 * ✅ Regroupe correctement les pages produits Binder par "famille + typeProduit stable"
 * ✅ Construit availableOptions (issus de ton script d'origine) SAUF contactsDisponibles :
 *    - longueurs, formes, genres, blindages, contacts, standards, ips
 * ✅ Variants “light” (ref + url + title) + (optionnel) mainImageUrl pour choisir une image canonique
 * ✅ Nettoie TOUJOURS les anciens JSON + images (sauf KEEP_OLD=1)
 *
 * Dépendances :
 *   npm i cheerio xml2js
 *
 * Node >= 18 (fetch natif).
 *
 * Variables env :
 *   MAX_PRODUCTS=0 (0 = tout)
 *   DELAY_MS=120
 *   KEEP_OLD=0 (1 = ne supprime rien)
 */

import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

const OUT_DIR = path.resolve("produits/connecteur/fiche"); // groupes
const IMG_DIR = path.resolve("produits/connecteur/img"); // 1 image/groupe

const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS || 0); // 0 = tout
const DELAY_MS = Number(process.env.DELAY_MS || 120);
const KEEP_OLD = (process.env.KEEP_OLD || "0") === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function norm(s) {
  return clean(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/g, "'")
    .replace(/[×✕]/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

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

function ensureDirsAndCleanup() {
  if (KEEP_OLD) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(IMG_DIR, { recursive: true });
    console.log("KEEP_OLD=1 -> pas de nettoyage.");
    return;
  }

  console.log("Nettoyage: suppression totale anciens JSON + images…");
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.rmSync(IMG_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });
}

/**
 * ✅ FILTRE familles AVANT crawl
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

function slugify(s) {
  return clean(s)
    .toLowerCase()
    .replace(/[’']/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Ref depuis URL (fallback uniquement) */
function extractRefFromUrl(productUrl) {
  const m = productUrl.match(/\b(\d{2}-\d{4}-\d{2}-\d{2}|\d{2}-\d{4}-\d{3}-\d{3})\b/);
  return m ? m[1].replace(/-/g, " ") : null;
}

/** Ref depuis texte (plusieurs formats) */
function extractRefFromText($) {
  const txt = clean($("body").text());

  let m = txt.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/);
  if (m) return m[0];

  m = txt.match(/\b\d{2}\s\d{4}\s\d{2}\s\d{2}\b/);
  if (m) return m[0];

  return null;
}

function normalizeRef(ref) {
  const s = clean(ref || "");
  if (!s) return null;
  return s
    .replace(/[–—]/g, "-")
    .replace(/[./]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-")
    .replace(/-+/g, "-");
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

// Trouve une valeur dans sections avec plusieurs clés possibles
function pickFirstSectionValue(sections, keys) {
  const wanted = new Set(keys.map((k) => norm(k)));
  for (const kv of Object.values(sections || {})) {
    if (!kv) continue;
    for (const [k, v] of Object.entries(kv)) {
      if (wanted.has(norm(k))) return clean(v);
    }
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

/**
 * ✅ Genres/forme robustes :
 * - gère "male+2femelles", etc. (via comptage)
 * - forme: droit/coude/mixte
 */
function parseGenreEtForme(design, title) {
  const s = norm([design, title].filter(Boolean).join(" | "));

  const maleCount =
    (s.match(/\bmale\b/g) || []).length +
    (s.match(/\bmle\b/g) || []).length +
    (s.match(/\bmale\b/g) || []).length +
    (s.match(/\bmâle\b/g) || []).length;

  const femelleCount = (s.match(/\bfemelle\b/g) || []).length;

  let genrePattern = "unknown";
  if (maleCount > 0 || femelleCount > 0) {
    const parts = [];
    if (maleCount > 0) parts.push(maleCount === 1 ? "male" : `${maleCount}males`);
    if (femelleCount > 0) parts.push(femelleCount === 1 ? "femelle" : `${femelleCount}femelles`);
    genrePattern = parts.join("+");
  }

  const hasCoude = /\bcoude\b|\bcoud(e|é)\b|\bangle\b/.test(s);
  const hasDroit = /\bdroit\b/.test(s);

  let formePattern = "unknown";
  if (hasCoude && hasDroit) formePattern = "mixte";
  else if (hasCoude) formePattern = "coude";
  else if (hasDroit) formePattern = "droit";

  return { genrePattern, formePattern };
}

/**
 * ✅ Blindage robuste : non-blinde / blindable / blinde
 */
function parseBlindage(sections, title) {
  const blob = norm(JSON.stringify(sections || {})) + " " + norm(title || "");
  if (/\bnon blinde\b/.test(blob)) return "non-blinde";
  if (/\bblindable\b/.test(blob)) return "blindable";
  if (/\bblinde\b/.test(blob)) return "blinde";
  return "unknown";
}

/**
 * ✅ Standard (un seul champ)
 */
function parseStandardFromSections(sections) {
  const v = pickFirstSectionValue(sections, ["Norme de conception", "Norme", "Standard"]);
  return v ? v : "unknown";
}

/**
 * ✅ IP (un seul champ)
 */
function parseIPFromSectionsOrTitle(sections, title) {
  const blob = norm(
    (pickFirstSectionValue(sections, ["Indice de protection", "Indice de Protection", "IP"]) || "") +
      " " +
      (title || "") +
      " " +
      JSON.stringify(sections || {})
  );

  const re = /\bip\s*([0-9]{2})(k)?\b/;
  const m = blob.match(re);
  if (!m) return "unknown";
  return `ip${m[1]}${m[2] ? "k" : ""}`;
}

/**
 * ✅ Contacts (variante)
 * - gère "Contacts: 6+PE" (on récupère 6)
 * - sinon "Contacts: 8"
 * - sinon null
 */
function parseContactsFromText(title, sections) {
  const s = norm((title || "") + " " + JSON.stringify(sections || {}));

  let m = s.match(/contacts?\s*:\s*(\d{1,2})\s*\+\s*pe\b/);
  if (m) return Number(m[1]);

  m = s.match(/contacts?\s*:\s*(\d{1,2})\b/);
  if (m) return Number(m[1]);

  // fallback: "(08-a)" -> 8
  m = s.match(/\b\((\d{2})-[a-z]\)\b/);
  if (m) return parseInt(m[1], 10);

  return null;
}

/**
 * ✅ Longueur (une seule valeur)
 */
function parseLongueurFromSections(sections, title) {
  const candidates = [
    pickFirstSectionValue(sections, ["Passage de câble", "Passage de cable"]),
    pickFirstSectionValue(sections, ["Longueur de câble", "Longueur de cable"]),
    pickFirstSectionValue(sections, ["Câble", "Cable"])
  ].filter(Boolean);

  if (title) candidates.push(title);

  const reRangeMm = /(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*mm/i;
  const reMeters = /\b(\d{1,3})\s*m\b/i;

  for (const c of candidates) {
    const s = clean(c);
    let m = s.match(reRangeMm);
    if (m) {
      const a = String(m[1]).replace(",", ".");
      const b = String(m[2]).replace(",", ".");
      return `${a}-${b}mm`;
    }
    m = s.match(reMeters);
    if (m) return `${m[1]}m`;
  }

  return "unknown";
}

/**
 * ✅ typeProduit stable
 */
function computeTypeProduitFromTitle(title, { genrePattern, formePattern, blindage, standard, longueur, ip }) {
  let s = clean(title || "");
  if (!s) return "unknown";

  let parts = s.split(/[,|]+/g).map((p) => clean(p)).filter(Boolean);
  const removeIf = (pred) => {
    parts = parts.filter((p) => !pred(norm(p)));
  };

  removeIf((p) => /^contacts?\s*:/.test(p));
  removeIf((p) => /\bip\s*\d{2}(k)?\b/.test(p));
  removeIf((p) => /\b\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*mm\b/.test(p));
  removeIf((p) => /\b\d{1,3}\s*m\b/.test(p));

  const rmVal = (val) => {
    if (!val || val === "unknown") return;
    const v = norm(val).replace(/-/g, " ");
    removeIf((p) => p.includes(v));
  };

  rmVal(genrePattern);
  rmVal(formePattern);
  rmVal(blindage);
  rmVal(standard);
  if (longueur && longueur !== "unknown") rmVal(longueur);
  if (ip && ip !== "unknown") rmVal(ip);

  const base = parts.length ? parts.join(" ") : s;
  return slugify(base) || "unknown";
}

function pickBestCanonicalVariant(variants) {
  const withImg = variants.find((v) => v.mainImageUrl);
  if (withImg) return withImg;
  return variants[0] || null;
}

// -------------------------
// ✅ MAIN
// -------------------------
async function main() {
  ensureDirsAndCleanup();

  console.log("Lecture sitemap products…");
  let urls = await getAllProductUrlsFromSitemap();
  console.log(`Produits sitemap (total): ${urls.length}`);

  urls = filterUrlsByPrefixes(urls);
  console.log(`Produits après filtre familles: ${urls.length}`);

  if (MAX_PRODUCTS > 0) urls = urls.slice(0, MAX_PRODUCTS);

  const groups = new Map();
  let skippedNoRef = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const family = getFamilyFromUrl(url);
    console.log(`[${i + 1}/${urls.length}] [${family}] ${url}`);

    let html;
    try {
      html = await fetchText(url);
    } catch (e) {
      console.warn(`  ⚠️ fetch failed: ${e.message}`);
      await sleep(DELAY_MS);
      continue;
    }

    const $ = cheerio.load(html);

    const title = clean($("h1").first().text()) || null;
    const category1 = extractCategory1FromUrl(url);

    const secA = extractSectionsBinderAccordion($);
    const secB = extractTechnicalTablesFallback($);
    const sections = mergeSections(secA, secB);

    let ref = refFromSections(sections) || extractRefFromText($) || extractRefFromUrl(url);
    ref = normalizeRef(ref);

    if (!ref) {
      console.warn("  ❌ Ref introuvable => skip");
      skippedNoRef++;
      await sleep(DELAY_MS);
      continue;
    }

    const design = pickFirstSectionValue(sections, ["Design du connecteur", "Design"]) || "";
    const { genrePattern, formePattern } = parseGenreEtForme(design, title);

    const blindage = parseBlindage(sections, title);
    const standard = parseStandardFromSections(sections);
    const ip = parseIPFromSectionsOrTitle(sections, title);
    const longueur = parseLongueurFromSections(sections, title);
    const contacts = parseContactsFromText(title, sections);

    const mainImageUrl = extractMainImageUrl($, url) || null;

    const typeProduit = computeTypeProduitFromTitle(title, {
      genrePattern,
      formePattern,
      blindage,
      standard,
      longueur,
      ip
    });

    const groupKey = `${family}__${typeProduit}`;
    const groupSlug = slugify(groupKey);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        group: {
          key: groupKey,
          slug: groupSlug,
          family,
          typeProduit,
          category1
        },
        availableOptions: {
          longueurs: new Set(),
          formes: new Set(),
          genres: new Set(),
          blindages: new Set(),
          contacts: new Set(),
          standards: new Set(),
          ips: new Set()
        },
        variants: []
      });
    }

    const g = groups.get(groupKey);

    g.availableOptions.longueurs.add(longueur || "unknown");
    g.availableOptions.formes.add(formePattern || "unknown");
    g.availableOptions.genres.add(genrePattern || "unknown");
    g.availableOptions.blindages.add(blindage || "unknown");
    g.availableOptions.standards.add(standard || "unknown");
    g.availableOptions.ips.add(ip || "unknown");
    if (typeof contacts === "number") g.availableOptions.contacts.add(contacts);

    g.variants.push({
      ref,
      url,
      title,
      mainImageUrl
    });

    await sleep(DELAY_MS);
  }

  const indexGroups = [];

  for (const [_, g] of groups.entries()) {
    const availableOptions = {
      longueurs: Array.from(g.availableOptions.longueurs).sort(),
      formes: Array.from(g.availableOptions.formes).sort(),
      genres: Array.from(g.availableOptions.genres).sort(),
      blindages: Array.from(g.availableOptions.blindages).sort(),
      standards: Array.from(g.availableOptions.standards).sort(),
      ips: Array.from(g.availableOptions.ips).sort(),
      contacts: Array.from(g.availableOptions.contacts).sort((a, b) => a - b)
    };

    const canonicalVariant = pickBestCanonicalVariant(g.variants);

    let mainImageLocal = null;
    const chosenImageUrl = canonicalVariant?.mainImageUrl || null;

    if (chosenImageUrl) {
      const ext = getImageExtensionFromUrl(chosenImageUrl);
      const imgFilename = `${g.group.slug}${ext}`;
      const imgDest = path.join(IMG_DIR, imgFilename);
      try {
        await downloadToFile(chosenImageUrl, imgDest);
        mainImageLocal = `produits/connecteur/img/${imgFilename}`;
      } catch (e) {
        console.warn(`  ⚠️ image download failed for group ${g.group.slug}: ${e.message}`);
      }
    }

    const canonical = canonicalVariant
      ? {
          ref: canonicalVariant.ref,
          url: canonicalVariant.url,
          title: canonicalVariant.title,
          mainImage: mainImageLocal,
          mainImageUrl: chosenImageUrl
        }
      : null;

    const out = {
      generatedAt: new Date().toISOString(),
      group: g.group,
      availableOptions,
      canonical,
      variants: g.variants.map((v) => ({
        ref: v.ref,
        url: v.url,
        title: v.title
      }))
    };

    const jsonFilename = `${g.group.slug}.json`;
    fs.writeFileSync(path.join(OUT_DIR, jsonFilename), JSON.stringify(out, null, 2), "utf-8");

    indexGroups.push({
      key: g.group.key,
      slug: g.group.slug,
      family: g.group.family,
      typeProduit: g.group.typeProduit,
      category1: g.group.category1,
      file: `produits/connecteur/fiche/${jsonFilename}`,
      mainImage: canonical?.mainImage || null,
      variantsCount: out.variants.length
    });
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        groupsCount: indexGroups.length,
        skippedNoRef,
        families: FAMILY_PREFIXES.map((x) => x.family),
        groups: indexGroups.sort((a, b) => a.slug.localeCompare(b.slug))
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`✅ Terminé. Groupes: ${indexGroups.length} | noRef skipped: ${skippedNoRef}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});