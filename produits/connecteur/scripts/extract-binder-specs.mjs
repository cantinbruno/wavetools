import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

const OUT_DIR = path.resolve("produits/connecteur/fiche");
const IMG_DIR = path.resolve("produits/connecteur/img");

// 0 = tout
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS || 0);
const DELAY_MS = Number(process.env.DELAY_MS || 120);
const KEEP_OLD = (process.env.KEEP_OLD || "0") === "1";

const FETCH_RETRIES = Number(process.env.FETCH_RETRIES || 4);
const RETRY_BACKOFF_MULT = Number(process.env.RETRY_BACKOFF_MULT || 2);

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
 * ✅ familles autorisées (filtrage AVANT crawl)
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

/** Ref depuis URL (rapide, sans crawl) */
function extractRefFromUrl(productUrl) {
  const m = productUrl.match(/\b(\d{2}-\d{4}-\d{2}-\d{2}|\d{2}-\d{4}-\d{3}-\d{3})\b/);
  return m ? m[1].replace(/-/g, " ") : null;
}

function slugRef(ref) {
  // "99 0530 24 04" -> "99-0530-24-04"
  // "08 2679 000 001" -> "08-2679-000-001"
  return clean(ref).replace(/\s+/g, "-");
}

function safeFileSlug(s) {
  // slug safe filename
  return clean(s)
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Ref depuis texte (si crawl) */
function extractRefFromText($) {
  const txt = clean($("body").text());

  let m = txt.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/);
  if (m) return m[0];

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

/* ------------------- Parsing options depuis URL (sans crawl) ------------------- */

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

  // longueur: 40-60 / 41-78 / 60-80 / 80-100 / 40-80 ...
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

/**
 * On stocke les variants en liste (simple et robuste).
 * Ton front pourra filtrer facilement.
 */
function variantKey(v) {
  // évite les doublons exacts (mêmes attributs + url)
  return [
    v.contacts ?? "unknown",
    v.standard ?? "unknown",
    v.genre ?? "unknown",
    v.blindage ?? "unknown",
    v.forme ?? "unknown",
    v.longueur ?? "unknown",
    v.url
  ].join("|");
}

function pickCanonicalVariant(candidates) {
  // Heuristique simple : préférer droit + blindable + ip68 + longueur “standard” + éviter contacts séparés/versions courtes
  const lenPref = ["60-80", "40-60", "80-100", "41-78", "40-80", "unknown"];

  function score(c) {
    const o = c.options;
    let s = 0;

    if (o.flags?.contactsSepares) return -10_000;

    if (o.forme === "droit") s += 30;
    if (o.blindage === "blindable") s += 20;

    if (o.ip === "ip68") s += 10;
    if (o.ip === "ip67") s += 2;

    const li = lenPref.indexOf(o.longueur);
    s += li === -1 ? 0 : (10 - li);

    if (o.flags?.versionCourte) s -= 6;
    if (o.flags?.aisg) s -= 2;

    // bonus si on a une ref dans l’URL
    if (c.ref) s += 4;

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

/* -------------------------------------------------------------------------- */

async function main() {
  ensureDirsAndCleanup();

  console.log("Lecture sitemap products…");
  let urls = await getAllProductUrlsFromSitemap();
  console.log(`Produits sitemap (total): ${urls.length}`);

  urls = filterUrlsByPrefixes(urls);
  console.log(`Produits après filtre familles: ${urls.length}`);

  if (MAX_PRODUCTS > 0) urls = urls.slice(0, MAX_PRODUCTS);

  // ✅ Pré-regroupement SANS crawl
  // groupKey = family + terminaison (tu peux changer si tu veux grouper autrement)
  const grouped = new Map();

  for (const url of urls) {
    const family = getFamilyFromUrl(url);
    if (!family) continue;

    const options = parseVariantOptionsFromUrl(url);
    const ref = extractRefFromUrl(url);
    const category1 = extractCategory1FromUrl(url);

    const groupKey = `${family}__${options.terminaison}`;
    const groupSlug = safeFileSlug(groupKey);

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        key: groupKey,
        slug: groupSlug,
        family,
        terminaison: options.terminaison,
        category1,
        optionsSets: {
          contacts: new Set(),
          standards: new Set(),
          genres: new Set(),
          blindages: new Set(),
          formes: new Set(),
          longueurs: new Set()
        },
        // variantes (liste unique)
        variantsMap: new Map(),
        // candidats canonique
        candidates: []
      });
    }

    const G = grouped.get(groupKey);

    if (options.contacts != null) G.optionsSets.contacts.add(options.contacts);
    G.optionsSets.standards.add(options.standard);
    G.optionsSets.genres.add(options.genre);
    G.optionsSets.blindages.add(options.blindage);
    G.optionsSets.formes.add(options.forme);
    G.optionsSets.longueurs.add(options.longueur);

    const v = {
      ref: ref || null,
      url,
      // Les critères que tu as demandés
      contacts: options.contacts,
      standard: options.standard,
      genre: options.genre,
      blindage: options.blindage,
      forme: options.forme,
      longueur: options.longueur,
      ip: options.ip,
      flags: options.flags
    };

    const vk = variantKey(v);
    if (!G.variantsMap.has(vk)) G.variantsMap.set(vk, v);

    G.candidates.push({
      url,
      ref,
      options
    });
  }

  console.log(`✅ Groupes construits (sans crawl): ${grouped.size}`);

  // ✅ Crawl UNIQUEMENT des canoniques : 1 page par groupe
  const indexGroups = [];
  let skippedCanonicalHttp = 0;
  let skippedCanonicalNoRef = 0;
  let skippedGroupImages = 0;

  for (const [groupKey, G] of grouped.entries()) {
    const canonical = pickCanonicalVariant(G.candidates);

    console.log(`[CANON] [${G.family}] [${G.terminaison}] ${canonical?.url ?? "(none)"}`);

    let title = null;
    let sections = {};
    let canonicalRef = canonical?.ref || null;
    let canonicalUrl = canonical?.url || null;

    let mainImageLocal = null;
    let mainImageUrl = null;

    if (canonicalUrl) {
      // fetch canonique + sections + ref fiable + image
      let html;
      try {
        html = await fetchText(canonicalUrl);
      } catch (e) {
        console.warn(`  ❌ Canon skip (HTTP): ${e.message}`);
        skippedCanonicalHttp++;
        // On écrit quand même le groupe, juste sans image/sections
        html = null;
      }

      if (html) {
        const $ = cheerio.load(html);

        title = clean($("h1").first().text()) || null;

        const secA = extractSectionsBinderAccordion($);
        const secB = extractTechnicalTablesFallback($);
        sections = mergeSections(secA, secB);

        // ref fiable (si dispo dans page)
        canonicalRef = refFromSections(sections) || extractRefFromText($) || canonicalRef || extractRefFromUrl(canonicalUrl);
        if (!canonicalRef) {
          console.warn("  ⚠️ Ref canon introuvable (groupe écrit mais sans ref canon)");
          skippedCanonicalNoRef++;
        }

        // image
        try {
          const imgUrl = extractMainImageUrl($, canonicalUrl);
          if (imgUrl) {
            mainImageUrl = imgUrl;

            // nom image = basé sur le groupe (stable) pour avoir 1 image par groupe
            const ext = getImageExtensionFromUrl(imgUrl);
            const imgFilename = `${G.slug}${ext}`;
            const imgDest = path.join(IMG_DIR, imgFilename);

            await downloadToFile(imgUrl, imgDest);
            mainImageLocal = `produits/connecteur/img/${imgFilename}`;
          } else {
            skippedGroupImages++;
          }
        } catch (e) {
          console.warn(`  ⚠️ Image canon skip: ${e.message}`);
          skippedGroupImages++;
        }
      }

      await sleep(DELAY_MS);
    }

    // ✅ Construction JSON groupe
    const variants = Array.from(G.variantsMap.values());

    const groupJson = {
      generatedAt: new Date().toISOString(),
      group: {
        key: G.key,
        slug: G.slug,
        family: G.family,
        terminaison: G.terminaison,
        category1: G.category1
      },
      availableOptions: {
        // utile pour UI filtres
        contacts: setToSortedArray(G.optionsSets.contacts, true),
        standards: setToSortedArray(G.optionsSets.standards),
        genres: setToSortedArray(G.optionsSets.genres),
        blindages: setToSortedArray(G.optionsSets.blindages),
        formes: setToSortedArray(G.optionsSets.formes),
        longueurs: setToSortedArray(G.optionsSets.longueurs)
      },
      canonical: {
        ref: canonicalRef,
        url: canonicalUrl,
        title,
        mainImage: mainImageLocal,
        mainImageUrl
      },
      variants
    };

    // ✅ 1 fichier JSON par groupe
    const groupFilename = `${G.slug}.json`;
    const groupPath = path.join(OUT_DIR, groupFilename);
    fs.writeFileSync(groupPath, JSON.stringify(groupJson, null, 2), "utf-8");

    indexGroups.push({
      key: G.key,
      family: G.family,
      terminaison: G.terminaison,
      file: `produits/connecteur/fiche/${groupFilename}`,
      image: mainImageLocal,
      canonicalUrl
    });
  }

  // ✅ index des groupes
  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        groupCount: indexGroups.length,
        skippedCanonicalHttp,
        skippedCanonicalNoRef,
        skippedGroupImages,
        families: FAMILY_PREFIXES.map((x) => x.family),
        groups: indexGroups
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(
    `✅ Terminé. Groupes: ${indexGroups.length} | Canon HTTP skipped: ${skippedCanonicalHttp} | Canon noRef: ${skippedCanonicalNoRef} | Group images skipped: ${skippedGroupImages}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});