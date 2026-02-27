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

const FETCH_RETRIES = Number(process.env.FETCH_RETRIES || 4); // nb tentatives total
const RETRY_BACKOFF_MULT = Number(process.env.RETRY_BACKOFF_MULT || 2); // backoff = DELAY_MS * attempt * mult

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function isRetryableStatus(code) {
  return [429, 500, 502, 503, 504].includes(code);
}

async function fetchText(url, attempt = 1) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });

  if (res.ok) return res.text();

  if (isRetryableStatus(res.status) && attempt < FETCH_RETRIES) {
    const backoff = DELAY_MS * attempt * RETRY_BACKOFF_MULT;
    console.warn(`  ⚠️ HTTP ${res.status} sur ${url} -> retry ${attempt}/${FETCH_RETRIES - 1} dans ${backoff}ms`);
    await sleep(backoff);
    return fetchText(url, attempt + 1);
  }

  throw new Error(`HTTP ${res.status} on ${url}`);
}

async function downloadToFile(url, destPath, attempt = 1) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });

  if (res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return;
  }

  if (isRetryableStatus(res.status) && attempt < FETCH_RETRIES) {
    const backoff = DELAY_MS * attempt * RETRY_BACKOFF_MULT;
    console.warn(`  ⚠️ Image HTTP ${res.status} -> retry ${attempt}/${FETCH_RETRIES - 1} dans ${backoff}ms`);
    await sleep(backoff);
    return downloadToFile(url, destPath, attempt + 1);
  }

  throw new Error(`Image HTTP ${res.status} on ${url}`);
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

/* -------------------------------------------------------------------------- */
/* ✅ NOUVEAU: parsing options depuis l'URL + regroupement + image canonique   */
/* -------------------------------------------------------------------------- */

function getSlug(productUrl) {
  try {
    const u = new URL(productUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function parseVariantOptionsFromUrl(productUrl) {
  const slug = getSlug(productUrl);

  const genre = slug.includes("connecteur-male")
    ? "male"
    : slug.includes("connecteur-femelle")
      ? "femelle"
      : "unknown";

  const forme = slug.includes("-coude-") ? "coude" : "droit";

  const mContacts = slug.match(/contacts-(\d+)/);
  const contacts = mContacts ? Number(mContacts[1]) : null;

  const standard = slug.includes("-din-") ? "din" : slug.includes("-stereo-") ? "stereo" : "none";

  // longueur: on capture 40-60-mm, 41-78-mm, 40-80-mm, 80-100-mm...
  const mLen = slug.match(/(\d{2}-\d{2,3})-mm/);
  const longueur = mLen ? mLen[1] : "unknown";

  const blindage = slug.includes("blindable") ? "blindable" : slug.includes("non-blinde") ? "non-blinde" : "unknown";

  const terminaison = slug.includes("pince-a-visser")
    ? "pince-a-visser"
    : slug.includes("souder")
      ? "souder"
      : slug.includes("sertir")
        ? "sertir"
        : "unknown";

  const ip = slug.includes("ip68") ? "ip68" : slug.includes("ip67") ? "ip67" : "unknown";

  const versionCourte = slug.includes("version-courte");
  const aisg = slug.includes("aisg-conforme");
  const contactsSepares = slug.includes("doivent-etre-commandes-separement");

  return {
    genre,
    forme,
    contacts,
    standard,
    longueur,
    blindage,
    terminaison,
    ip,
    flags: { versionCourte, aisg, contactsSepares }
  };
}

function pickCanonicalVariant(candidates) {
  // candidates: array of { url, ref, options }
  const lenPref = ["60-80", "40-60", "80-100", "41-78", "unknown"];

  function score(v) {
    const o = v.options;
    let s = 0;

    // "sertir + contacts séparés" => on évite en canonique
    if (o.flags?.contactsSepares) return -10_000;

    if (o.blindage === "blindable") s += 20;
    if (o.forme === "droit") s += 10;

    const li = lenPref.indexOf(o.longueur);
    s += li === -1 ? 0 : (10 - li);

    if (o.ip === "ip68") s += 10;
    if (o.ip === "ip67") s += 2;

    if (o.flags?.versionCourte) s -= 8;
    if (o.flags?.aisg) s -= 3;

    return s;
  }

  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const sc = score(c);
    if (sc > bestScore) {
      best = c;
      bestScore = sc;
    }
  }
  return best;
}

function setToSortedArray(set, numeric = false) {
  const arr = Array.from(set);
  if (numeric) return arr.sort((a, b) => Number(a) - Number(b));
  return arr.sort();
}

function pushVariantNested(variants, options, payload) {
  const c = String(options.contacts ?? "unknown");
  const st = options.standard ?? "unknown";
  const g = options.genre ?? "unknown";
  const bl = options.blindage ?? "unknown";
  const f = options.forme ?? "unknown";
  const l = options.longueur ?? "unknown";

  variants[c] ??= {};
  variants[c][st] ??= {};
  variants[c][st][g] ??= {};
  variants[c][st][g][bl] ??= {};
  variants[c][st][g][bl][f] ??= {};
  variants[c][st][g][bl][f][l] ??= [];

  variants[c][st][g][bl][f][l].push(payload);
}

/* -------------------------------------------------------------------------- */

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
  let skippedHttp = 0;

  // ✅ regroupement
  // Par défaut: groupKey = family + terminaison
  const grouped = new Map();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const family = getFamilyFromUrl(url); // garanti non-null ici
    console.log(`[${i + 1}/${urls.length}] [${family}] ${url}`);

    // ✅ fetch résilient (skip au lieu de crash)
    let html;
    try {
      html = await fetchText(url);
    } catch (e) {
      console.warn(`  ❌ Skip (page inaccessible): ${e.message}`);
      skippedHttp++;
      await sleep(DELAY_MS);
      continue;
    }

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

    // ✅ On garde la capacité d'extraire l'image, mais on ne télécharge pas ici.
    const mainImageUrl = extractMainImageUrl($, url);

    // ✅ JSON = même nom que ref (fonctionnalité d'avant conservée)
    const jsonFilename = `${refSlug}.json`;
    const jsonPath = path.join(OUT_DIR, jsonFilename);

    const data = {
      ref,
      title,
      url,
      family,
      category1,
      mainImage: null, // image locale réservée au canonique du regroupement
      mainImageUrl: mainImageUrl || null,
      sections
    };

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");

    indexItems.push({
      ref,
      title,
      url,
      family,
      category1,
      mainImage: null,
      file: `produits/connecteur/fiche/${jsonFilename}`
    });

    // ✅ Ajout au regroupement
    const options = parseVariantOptionsFromUrl(url);
    const groupKey = `${family}__${options.terminaison}`;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        key: groupKey,
        family,
        terminaison: options.terminaison,
        options: {
          contacts: new Set(),
          standards: new Set(),
          genres: new Set(),
          blindages: new Set(),
          formes: new Set(),
          longueurs: new Set()
        },
        variants: {},
        _candidatesForImage: [] // interne
      });
    }

    const G = grouped.get(groupKey);

    if (options.contacts != null) G.options.contacts.add(options.contacts);
    G.options.standards.add(options.standard);
    G.options.genres.add(options.genre);
    G.options.blindages.add(options.blindage);
    G.options.formes.add(options.forme);
    G.options.longueurs.add(options.longueur);

    pushVariantNested(G.variants, options, {
      ref,
      url,
      file: `produits/connecteur/fiche/${jsonFilename}`,
      mainImageUrl: mainImageUrl || null
    });

    G._candidatesForImage.push({
      ref,
      url,
      options
    });

    await sleep(DELAY_MS);
  }

  // ✅ Index (comme avant)
  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: indexItems.length,
        skippedNoRef,
        skippedHttp,
        families: FAMILY_PREFIXES.map((x) => x.family),
        items: indexItems
      },
      null,
      2
    ),
    "utf-8"
  );

  // ✅ grouped.json + 1 image par regroupement (image du canonique)
  const groupedOut = [];
  let skippedGroupImages = 0;

  for (const [key, G] of grouped.entries()) {
    const canonical = pickCanonicalVariant(G._candidatesForImage);

    let mainImageLocal = null;
    let canonicalImageUrl = null;

    if (canonical) {
      try {
        // refetch canonique (robuste)
        const html = await fetchText(canonical.url);
        const $ = cheerio.load(html);
        const imgUrl = extractMainImageUrl($, canonical.url);

        if (imgUrl) {
          canonicalImageUrl = imgUrl;
          const ext = getImageExtensionFromUrl(imgUrl);
          const imgFilename = `${slugRef(canonical.ref)}${ext}`;
          const imgDest = path.join(IMG_DIR, imgFilename);

          try {
            await downloadToFile(imgUrl, imgDest);
            mainImageLocal = `produits/connecteur/img/${imgFilename}`;
          } catch (e) {
            console.warn(`  ⚠️ Image skip (download fail): ${e.message}`);
            skippedGroupImages++;
          }
        } else {
          skippedGroupImages++;
        }
      } catch (e) {
        console.warn(`  ⚠️ Canonical fetch/image skip pour ${key}: ${e.message}`);
        skippedGroupImages++;
      }
    } else {
      skippedGroupImages++;
    }

    groupedOut.push({
      key,
      family: G.family,
      terminaison: G.terminaison,
      options: {
        contacts: setToSortedArray(G.options.contacts, true),
        standards: setToSortedArray(G.options.standards),
        genres: setToSortedArray(G.options.genres),
        blindages: setToSortedArray(G.options.blindages),
        formes: setToSortedArray(G.options.formes),
        longueurs: setToSortedArray(G.options.longueurs)
      },
      canonical: canonical
        ? {
            ref: canonical.ref,
            url: canonical.url,
            mainImage: mainImageLocal,
            mainImageUrl: canonicalImageUrl
          }
        : {
            ref: null,
            url: null,
            mainImage: null,
            mainImageUrl: null
          },
      variants: G.variants
    });
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "grouped.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        groupCount: groupedOut.length,
        skippedGroupImages,
        // note: groupKey = family + terminaison
        groups: groupedOut
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(
    `✅ Terminé. Produits exportés: ${indexItems.length} | noRef skipped: ${skippedNoRef} | http skipped: ${skippedHttp} | groups: ${groupedOut.length} | group images skipped: ${skippedGroupImages}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});