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

function slugRef(ref) {
  return clean(ref).replace(/\s+/g, "-");
}

function safeFileSlug(s) {
  return clean(s)
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

/**
 * ✅ Ref depuis URL (amélioré)
 * Supporte:
 * - 99-5101-15-02
 * - 08-2679-000-001
 * - 77-0649-0000-50505-0200
 */
function extractRefFromUrl(productUrl) {
  const m = productUrl.match(
    /\b(\d{2}-\d{4}-\d{2}-\d{2}|\d{2}-\d{4}-\d{3}-\d{3}|\d{2}-\d{4}-\d{4}-\d{5}-\d{4})\b/
  );
  return m ? m[1].replace(/-/g, " ") : null;
}

/** Ref depuis texte (plusieurs formats) */
function extractRefFromText($) {
  const txt = clean($("body").text());

  let m = txt.match(/\b\d{2}\s\d{4}\s\d{3}\s\d{3}\b/);
  if (m) return m[0];

  m = txt.match(/\b\d{2}\s\d{4}\s\d{2}\s\d{2}\b/);
  if (m) return m[0];

  m = txt.match(/\b\d{2}\s\d{4}\s\d{4}\s\d{5}\s\d{4}\b/);
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

/* ------------------- parsing URL (avant crawl) ------------------- */

function getSlug(productUrl) {
  try {
    const u = new URL(productUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function detectTypeProduit(slug) {
  if (slug.includes("repartiteur") || slug.includes("distributeur") || slug.includes("double-t") || slug.includes("t-distributeur"))
    return "repartiteur";
  if (slug.includes("adaptateur")) return "adaptateur";
  if (slug.includes("traversee-de-panneau")) return "traversee-panneau";
  if (slug.includes("encastrable")) return "encastrable";
  if (slug.includes("embase")) return "embase";
  if (slug.includes("surmoule-sur-le-cable") || slug.includes("surmoule")) return "surmoule-cable";
  if (slug.includes("connecteur")) return "connecteur";
  return "autre";
}

function parseFromUrl(productUrl) {
  const slug = getSlug(productUrl);
  const typeProduit = detectTypeProduit(slug);

  const genre =
    slug.includes("-male-") ? "male" :
    slug.includes("-femelle-") ? "femelle" :
    (slug.includes("male") && !slug.includes("femelle")) ? "male" :
    (slug.includes("femelle") && !slug.includes("male")) ? "femelle" :
    "unknown";

  const forme = (slug.includes("-coude-") || slug.includes("dangle")) ? "coude" : "droit";

  const mContacts = slug.match(/contacts-(\d+)/);
  const contacts = mContacts ? Number(mContacts[1]) : null;

  const standard =
    slug.includes("-din-") ? "din" :
    slug.includes("-stereo-") ? "stereo" :
    "none";

  const blindage =
    slug.includes("non-blinde") ? "non-blinde" :
    slug.includes("blindable") ? "blindable" :
    (slug.includes("-blinde-") && !slug.includes("non-blinde")) ? "blinde" :
    "unknown";

  const mLenMm = slug.match(/(\d{2}-\d{2,3})-mm/);
  const longueur_mm = mLenMm ? `${mLenMm[1]}mm` : null;

  const mLenM = slug.match(/-(\d{1,3})-m\b/);
  const longueur_m = mLenM ? `${mLenM[1]}m` : null;

  const longueur = longueur_mm || longueur_m || "unknown";

  return { typeProduit, forme, longueur, genre, blindage, contacts, standard };
}

function missingCount(v) {
  let c = 0;
  if (!v.forme || v.forme === "unknown") c++;
  if (!v.longueur || v.longueur === "unknown") c++;
  if (!v.genre || v.genre === "unknown") c++;
  if (!v.blindage || v.blindage === "unknown") c++;
  if (v.contacts == null) c++;
  if (!v.standard || v.standard === "unknown") c++;
  return c;
}

function variantKey(v) {
  return [
    v.forme ?? "unknown",
    v.longueur ?? "unknown",
    v.genre ?? "unknown",
    v.blindage ?? "unknown",
    v.contacts ?? "unknown",
    v.standard ?? "unknown"
  ].join("|");
}

function setToSortedArray(set, numeric = false) {
  const arr = Array.from(set);
  if (numeric) return arr.sort((a, b) => Number(a) - Number(b));
  return arr.sort();
}

/* ------------------- enrichissement (après crawl) ------------------- */

function flattenSections(sections) {
  const flat = {};
  for (const kv of Object.values(sections || {})) {
    if (!kv) continue;
    for (const [k, v] of Object.entries(kv)) {
      const key = clean(k).toLowerCase();
      if (!flat[key]) flat[key] = clean(v);
    }
  }
  return flat;
}

function fillMissingFromPage(v, title, sections) {
  const flat = flattenSections(sections);
  const t = (title || "").toLowerCase();

  // genre
  if (v.genre === "unknown") {
    if (t.includes("femelle")) v.genre = "femelle";
    else if (t.includes("mâle") || t.includes("male")) v.genre = "male";
  }

  // blindage
  if (v.blindage === "unknown") {
    const b = (flat["blindage"] || flat["blindé"] || flat["blinde"] || "").toLowerCase();
    if (b.includes("non")) v.blindage = "non-blinde";
    else if (b.includes("blind")) v.blindage = "blinde";
  }

  // contacts
  if (v.contacts == null) {
    const c = flat["contacts"] || flat["contact"] || flat["nombre de contacts"] || "";
    const m = String(c).match(/(\d+)/);
    if (m) v.contacts = Number(m[1]);
  }

  // longueur (souvent câble)
  if (v.longueur === "unknown") {
    const l =
      flat["longueur de câble"] ||
      flat["longueur du câble"] ||
      flat["longueur de cable"] ||
      "";
    const mm = String(l).match(/(\d+)\s*mm/i);
    const m = String(l).match(/(\d+(?:[.,]\d+)?)\s*m\b/i);
    if (mm) v.longueur = `${mm[1]}mm`;
    else if (m) v.longueur = `${m[1].replace(",", ".")}m`;
  }

  // forme
  // (souvent déjà OK, mais on corrige si titre parle d'angle)
  if (v.forme === "droit" && (t.includes("angle") || t.includes("coud"))) {
    v.forme = "coude";
  }

  // standard
  // rarement absent, mais au cas où
  if (!v.standard || v.standard === "unknown") {
    const s = (flat["standard"] || flat["norme"] || "").toLowerCase();
    if (s.includes("din")) v.standard = "din";
    else if (s.includes("stereo")) v.standard = "stereo";
    else v.standard = "none";
  }

  return v;
}

/* ------------------- grouping ------------------- */

function ensureGroup(groups, family, typeProduit, category1) {
  const key = `${family}__${typeProduit}`;
  if (!groups.has(key)) {
    groups.set(key, {
      key,
      slug: safeFileSlug(key),
      family,
      typeProduit,
      category1,
      // options
      sets: {
        formes: new Set(),
        longueurs: new Set(),
        genres: new Set(),
        blindages: new Set(),
        contacts: new Set(),
        standards: new Set()
      },
      variantsMap: new Map(),
      // pour choisir une page canonique pour image
      canonicalCandidates: []
    });
  }
  return groups.get(key);
}

function addVariantToGroup(G, item) {
  // item: { ref, url, v }
  const k = variantKey(item.v);

  if (!G.variantsMap.has(k)) G.variantsMap.set(k, []);
  G.variantsMap.get(k).push({ ref: item.ref, url: item.url });

  // sets
  G.sets.formes.add(item.v.forme ?? "unknown");
  G.sets.longueurs.add(item.v.longueur ?? "unknown");
  G.sets.genres.add(item.v.genre ?? "unknown");
  G.sets.blindages.add(item.v.blindage ?? "unknown");
  if (item.v.contacts != null) G.sets.contacts.add(item.v.contacts);
  G.sets.standards.add(item.v.standard ?? "unknown");

  // score pour canonical (moins de unknown = mieux)
  G.canonicalCandidates.push({
    url: item.url,
    ref: item.ref,
    score: 100 - missingCount(item.v)
  });
}

function pickCanonicalUrl(G) {
  if (!G.canonicalCandidates.length) return null;
  G.canonicalCandidates.sort((a, b) => b.score - a.score);
  return G.canonicalCandidates[0].url;
}

/* ------------------- main ------------------- */

async function main() {
  ensureDirsAndCleanup();

  console.log("Lecture sitemap products…");
  let urls = await getAllProductUrlsFromSitemap();
  console.log(`Produits sitemap (total): ${urls.length}`);

  urls = filterUrlsByPrefixes(urls);
  console.log(`Produits après filtre familles: ${urls.length}`);

  if (MAX_PRODUCTS > 0) urls = urls.slice(0, MAX_PRODUCTS);

  const groups = new Map();

  // PASS 1 : regrouper tout ce qu'on peut depuis l'URL
  const pending = []; // urls qui manquent des infos
  for (const url of urls) {
    const family = getFamilyFromUrl(url);
    if (!family) continue;

    const category1 = extractCategory1FromUrl(url);
    const ref = extractRefFromUrl(url) || null;

    const v = parseFromUrl(url);
    const G = ensureGroup(groups, family, v.typeProduit, category1);

    const item = { ref, url, v };

    // si tout est “suffisant”, on ajoute direct
    // "standard=none" est OK, ce n'est pas un manque
    const needsPage =
      v.genre === "unknown" ||
      v.blindage === "unknown" ||
      v.longueur === "unknown" ||
      v.forme === "unknown" ||
      v.contacts == null;

    if (!needsPage) {
      addVariantToGroup(G, item);
    } else {
      pending.push(item);
    }
  }

  console.log(`✅ Groupes créés (URL): ${groups.size}`);
  console.log(`⏳ URLs à compléter (crawl seulement si manque): ${pending.length}`);

  // PASS 2 : crawler uniquement les URLs incomplètes et compléter
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const { url } = item;

    const family = getFamilyFromUrl(url);
    const category1 = extractCategory1FromUrl(url);

    // typeProduit est déjà dans item.v.typeProduit (depuis URL)
    const G = ensureGroup(groups, family, item.v.typeProduit, category1);

    console.log(`[DETAIL ${i + 1}/${pending.length}] ${url}`);

    try {
      const html = await fetchText(url);
      const $ = cheerio.load(html);

      const title = clean($("h1").first().text()) || null;

      const secA = extractSectionsBinderAccordion($);
      const secB = extractTechnicalTablesFallback($);
      const sections = mergeSections(secA, secB);

      // ref: sections -> texte -> url
      item.ref = item.ref || refFromSections(sections) || extractRefFromText($) || extractRefFromUrl(url) || null;

      // remplir ce qui manque
      fillMissingFromPage(item.v, title, sections);

      // ajouter au groupe final
      addVariantToGroup(G, item);
    } catch (e) {
      // si une page échoue, on n'explose pas : on ajoute quand même avec infos URL
      console.warn(`  ❌ detail fail: ${e.message} -> ajout avec URL only`);
      addVariantToGroup(G, item);
    }

    await sleep(DELAY_MS);
  }

  // PASS 3 : pour chaque groupe -> 1 image + 1 json
  const indexGroups = [];
  let skippedImages = 0;

  for (const [key, G] of groups.entries()) {
    const canonicalUrl = pickCanonicalUrl(G);

    let mainImageLocal = null;
    let mainImageUrl = null;
    let canonicalTitle = null;
    let canonicalRef = null;

    // On ne télécharge qu'une image par groupe -> donc on charge 1 seule page / groupe
    if (canonicalUrl) {
      try {
        const html = await fetchText(canonicalUrl);
        const $ = cheerio.load(html);

        canonicalTitle = clean($("h1").first().text()) || null;

        const secA = extractSectionsBinderAccordion($);
        const secB = extractTechnicalTablesFallback($);
        const sections = mergeSections(secA, secB);

        canonicalRef = refFromSections(sections) || extractRefFromText($) || extractRefFromUrl(canonicalUrl) || null;

        const imgUrl = extractMainImageUrl($, canonicalUrl);
        if (imgUrl) {
          mainImageUrl = imgUrl;
          const ext = getImageExtensionFromUrl(imgUrl);
          const imgFilename = `${G.slug}${ext}`;
          const imgDest = path.join(IMG_DIR, imgFilename);

          await downloadToFile(imgUrl, imgDest);
          mainImageLocal = `produits/connecteur/img/${imgFilename}`;
        } else {
          skippedImages++;
        }

        await sleep(DELAY_MS);
      } catch (e) {
        console.warn(`  ❌ Canon image fail (${G.key}): ${e.message}`);
      }
    }

    // construire JSON groupé
    const variantsObj = {};
    for (const [vk, arr] of G.variantsMap.entries()) {
      variantsObj[vk] = arr;
    }

    const data = {
      generatedAt: new Date().toISOString(),
      group: {
        key: G.key,
        slug: G.slug,
        family: G.family,
        typeProduit: G.typeProduit,
        category1: G.category1
      },
      availableOptions: {
        formes: setToSortedArray(G.sets.formes),
        longueurs: setToSortedArray(G.sets.longueurs),
        genres: setToSortedArray(G.sets.genres),
        blindages: setToSortedArray(G.sets.blindages),
        contacts: setToSortedArray(G.sets.contacts, true),
        standards: setToSortedArray(G.sets.standards)
      },
      canonical: {
        ref: canonicalRef,
        url: canonicalUrl,
        title: canonicalTitle,
        mainImage: mainImageLocal,
        mainImageUrl
      },
      // ✅ les variantes regroupées uniquement sur:
      // forme | longueur | genre | blindage | contacts | standard
      // valeur = liste {ref,url}
      variants: variantsObj
    };

    const jsonFilename = `${G.slug}.json`;
    const jsonPath = path.join(OUT_DIR, jsonFilename);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");

    indexGroups.push({
      key: G.key,
      family: G.family,
      typeProduit: G.typeProduit,
      file: `produits/connecteur/fiche/${jsonFilename}`,
      image: mainImageLocal,
      canonicalUrl
    });
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        groupCount: indexGroups.length,
        skippedImages,
        families: FAMILY_PREFIXES.map((x) => x.family),
        groups: indexGroups
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`✅ Terminé. Groupes: ${indexGroups.length} | Images manquantes: ${skippedImages}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});