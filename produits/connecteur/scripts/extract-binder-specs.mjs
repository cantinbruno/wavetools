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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

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

function slugRef(ref) {
  // "99 0530 24 04" -> "99-0530-24-04"
  // "08 2679 000 001" -> "08-2679-000-001"
  return clean(ref).replace(/\s+/g, "-");
}

function safeSlug(s) {
  return clean(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
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
/*                           ✅ REGROUPEMENT (NEW)                             */
/* -------------------------------------------------------------------------- */

/**
 * Objectif demandé:
 * - 1 JSON par GROUPE = family + typeProduit (typeProduit parsé depuis l'URL)
 * - Dans le JSON: availableOptions (forme, genre, longueur, blindage, contacts, standard)
 * - Variants: on regroupe les références par combinaison (forme|genre|longueur|blindage|contacts|standard)
 * - Pas de "mixte": si une URL contient male ET femelle → on duplique en 2 variants (genre=male puis genre=femelle)
 * - On regroupe AVANT chargement tout ce que l'URL donne; on charge la page seulement pour compléter ce qui manque,
 *   et pour récupérer UNE image par groupe.
 */

function getSlugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function stripLeadingRefFromSlug(slug) {
  // slug commence souvent par: 99-5101-15-02-...
  // ou 08-2679-000-001-...
  return slug
    .replace(/^(\d{2}-\d{4}-\d{2}-\d{2})-/, "")
    .replace(/^(\d{2}-\d{4}-\d{3}-\d{3})-/, "");
}

function stripLeadingFamilyToken(rest) {
  // ex: m16-ip67-connecteur-... => enlever m16-ip67
  // ex: m12-l-embase-... => enlever m12-l
  // ex: 7-8-adaptateur-... => enlever 7-8
  // ex: rd24-power-... => enlever rd24-power
  const knownStarts = ["m16-ip67", "m12-a", "m12-d", "m12-k", "m12-l", "m8-d", "m8", "7-8", "rd24-power"];
  for (const st of knownStarts) {
    if (rest.startsWith(st + "-")) return rest.slice(st.length + 1);
    if (rest === st) return "";
  }
  // fallback: si ça commence par m12-xxx / m16-xxx / m8-xxx etc, enlève le premier bloc
  const m = rest.match(/^(m\d{1,2}(?:-[a-z0-9]+){0,2})-(.+)$/i);
  if (m) return m[2];
  return rest;
}

// Stop words = tout ce qui est "variable" / optionnel, donc pas dans typeProduit
const TYPE_STOPWORDS = new Set([
  // forme
  "droit", "coude", "dangle", "angle",
  // genre
  "male", "mâle", "femelle",
  // contacts / blindage
  "contacts", "contact", "fe",
  "blindable", "blinde", "blindé", "blindee", "non", "non-blinde", "non-blindé",
  // indices / normes
  "ip", "ul", "aisg", "din", "stereo", "stéréo",
  // câble & matière (très variable)
  "surmoule", "surmoule-sur-le-cable", "cable", "câble", "pur", "pvc", "noir", "black",
  // filetage / dimensions (très variable)
  "mm", "mm2", "m12x10", "m12x1", "m16x15", "m12x1,0", "m12x1,0", "m12x1,0",
  // mots “catalogue”
  "en", "preparation", "preparation-",
  "visse", "visse-a-lavant", "montage", "frontal",
]);

function isStopToken(tok) {
  if (!tok) return true;
  const t = tok.toLowerCase();

  if (TYPE_STOPWORDS.has(t)) return true;

  // ip67, ip68, ip65...
  if (/^ip\d{2}$/i.test(t)) return true;

  // longueurs: 2-m / 5-m / 0200 / 0500 etc (sur certains slugs)
  if (/^\d{1,3}m$/i.test(t)) return true;
  if (/^\d{1,3}-m$/i.test(t)) return true;
  if (/^\d{2,4}$/.test(t)) return true;

  // plages en mm: 40-60-mm / 60-80-mm / 80-100-mm
  if (/^\d{2,3}-\d{2,3}$/.test(t)) return true;
  if (/^\d{2,3}-\d{2,3}-mm$/.test(t)) return true;

  // sections câble: 2,50 / 150 / 250 / 5-x-250-mm2 etc
  if (/^\d+([.,]\d+)?$/.test(t)) return true;
  if (/^\d+-x-\d+([.,]\d+)?-mm2$/.test(t)) return true;

  return false;
}

function parseTypeProduitFromUrl(url) {
  const rawSlug = getSlugFromUrl(url);
  let rest = stripLeadingRefFromSlug(rawSlug);
  rest = stripLeadingFamilyToken(rest);

  // split
  const tokens = rest.split("-").filter(Boolean);

  // on garde les tokens jusqu'au premier token "variable"
  const kept = [];
  for (const tok of tokens) {
    if (isStopToken(tok)) break;
    kept.push(tok);
  }

  // fallback: si on n'a rien, on essaie au moins de prendre le 1er token non vide
  if (!kept.length) {
    const first = tokens.find((t) => t && !isStopToken(t));
    return first ? first.toLowerCase() : "unknown";
  }

  return kept.join("-").toLowerCase();
}

function parseFormeFromUrl(url) {
  const s = getSlugFromUrl(url).toLowerCase();
  if (s.includes("-coude-") || s.includes("-dangle-") || s.includes("dangle")) return "coude";
  if (s.includes("-droit-")) return "droit";
  // certains slugs n'ont pas "droit" → on laisse unknown
  return "unknown";
}

function parseGenresFromUrl(url) {
  const s = getSlugFromUrl(url).toLowerCase();
  const hasMale = s.includes("-male-") || s.includes("mâle");
  const hasFemelle = s.includes("-femelle-");
  const out = [];
  if (hasMale) out.push("male");
  if (hasFemelle) out.push("femelle");
  return out.length ? out : ["unknown"];
}

function parseContactsFromUrl(url) {
  const s = getSlugFromUrl(url).toLowerCase();
  const m = s.match(/contacts-(\d{1,2})\b/);
  if (m) return Number(m[1]);
  return "unknown";
}

function parseBlindageFromUrl(url) {
  const s = getSlugFromUrl(url).toLowerCase();
  if (s.includes("non-blinde") || s.includes("non-blind")) return "non-blinde";
  if (s.includes("blindable")) return "blindable";
  // "blinde" peut exister (blindé)
  if (s.includes("blinde") || s.includes("blind")) return "blinde";
  return "unknown";
}

function parseStandardFromUrl(url) {
  const s = getSlugFromUrl(url).toLowerCase();
  if (s.includes("-din-")) return "din";
  if (s.includes("stereo") || s.includes("stéréo")) return "stereo";
  // aisg = plutôt un flag, pas un standard (mais tu peux l'utiliser si tu veux)
  return "none";
}

function parseLongueurFromUrl(url) {
  const s = getSlugFromUrl(url).toLowerCase();

  // 2-m / 5-m / 10-m
  let m = s.match(/(?:^|-) (\d{1,3})-m(?:-|$)/x); // regex x pas support JS -> fallback dessous
  // fallback JS:
  m = s.match(/(?:^|-)(\d{1,3})-m(?:-|$)/);
  if (m) return `${m[1]}m`;

  // plages mm: 40-60-mm
  m = s.match(/(?:^|-)(\d{2,3}-\d{2,3})-mm(?:-|$)/);
  if (m) return `${m[1]}mm`;

  return "unknown";
}

function parseIpFromUrl(url) {
  const s = getSlugFromUrl(url).toLowerCase();
  const m = s.match(/\bip(\d{2})\b/);
  return m ? `ip${m[1]}` : "unknown";
}

/**
 * Parse depuis texte (titre + body) pour compléter quand l'URL est insuffisante.
 * On reste “simple” : tu veux surtout éviter "unknown".
 */
function parseFromTextForFields(text) {
  const t = clean(text).toLowerCase();

  // forme
  let forme = "unknown";
  if (/\bcoud[ée]\b/.test(t) || /\bd[' ]angle\b/.test(t) || /\bangle\b/.test(t)) forme = "coude";
  else if (/\bdroit\b/.test(t)) forme = "droit";

  // genre (sans mixte)
  const genres = [];
  if (/\bm[âa]le\b/.test(t)) genres.push("male");
  if (/\bfemelle\b/.test(t)) genres.push("femelle");
  if (!genres.length) genres.push("unknown");

  // contacts
  let contacts = "unknown";
  let m = t.match(/contacts?\s*[:=]\s*(\d{1,2})/);
  if (m) contacts = Number(m[1]);

  // blindage
  let blindage = "unknown";
  if (t.includes("non blind")) blindage = "non-blinde";
  else if (t.includes("blindable")) blindage = "blindable";
  else if (t.includes("blindé") || t.includes("blinde")) blindage = "blinde";

  // standard
  let standard = "none";
  if (t.includes(" din ")) standard = "din";
  if (t.includes("stéréo") || t.includes("stereo")) standard = "stereo";

  // longueur: "2 m" / "5 m" / "40-60 mm"
  let longueur = "unknown";
  m = t.match(/\b(\d{1,3})\s*m\b/);
  if (m) longueur = `${m[1]}m`;
  m = t.match(/\b(\d{2,3})\s*[-–]\s*(\d{2,3})\s*mm\b/);
  if (m) longueur = `${m[1]}-${m[2]}mm`;

  // ip
  let ip = "unknown";
  m = t.match(/\bip\s*([0-9]{2})\b/);
  if (m) ip = `ip${m[1]}`;

  return { forme, genres, contacts, blindage, standard, longueur, ip };
}

function shouldFetchForUrl(pre) {
  // On fetch seulement si on a besoin de compléter des champs pour faire un JSON propre,
  // OU si ref est introuvable.
  if (!pre.ref) return true;

  // Si une des options clés manque, on tente de compléter par page.
  const need =
    pre.forme === "unknown" ||
    pre.genres.includes("unknown") ||
    pre.longueur === "unknown" ||
    pre.blindage === "unknown" ||
    pre.contacts === "unknown" ||
    pre.standard === "none"; // "none" est valide; si tu veux le compléter, change la règle

  // NOTE: standard="none" est souvent correct. Ici on ne force pas le fetch pour standard,
  // sinon tu vas refetch trop de pages. Tu peux activer en remplaçant par "|| pre.standard === 'none'".
  return (
    pre.forme === "unknown" ||
    pre.genres.includes("unknown") ||
    pre.longueur === "unknown" ||
    pre.blindage === "unknown" ||
    pre.contacts === "unknown"
  );
}

function variantKey(v) {
  return [
    v.forme ?? "unknown",
    v.genre ?? "unknown",
    v.longueur ?? "unknown",
    v.blindage ?? "unknown",
    v.contacts ?? "unknown",
    v.standard ?? "none"
  ].join("|");
}

function addToSetMap(setMap, key, value) {
  if (!setMap[key]) setMap[key] = new Set();
  setMap[key].add(value);
}

function finalizeOptionSet(s) {
  const arr = Array.from(s);
  // si on a autre chose que unknown, on vire unknown
  const hasKnown = arr.some((x) => x !== "unknown" && x !== null && x !== "" && x !== "none");
  if (arr.includes("unknown") && hasKnown) return arr.filter((x) => x !== "unknown");
  return arr;
}

/* -------------------------------------------------------------------------- */

async function main() {
  ensureDirsAndCleanup();

  console.log("Lecture sitemap products…");
  let urls = await getAllProductUrlsFromSitemap();
  console.log(`Produits sitemap (total): ${urls.length}`);

  // ✅ FILTRE AVANT CRAWL (familles)
  urls = filterUrlsByPrefixes(urls);
  console.log(`Produits après filtre familles: ${urls.length}`);

  if (MAX_PRODUCTS > 0) urls = urls.slice(0, MAX_PRODUCTS);

  // --- 1) Pré-groupement (AVANT chargement pages) ---
  const groups = new Map(); // groupKey -> groupData
  const fetchQueue = []; // urls à compléter
  let skippedNoFamily = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const family = getFamilyFromUrl(url);
    if (!family) {
      skippedNoFamily++;
      continue;
    }

    const category1 = extractCategory1FromUrl(url);
    const typeProduit = parseTypeProduitFromUrl(url);
    const groupKey = `${family}__${typeProduit}`;
    const groupSlug = safeSlug(groupKey);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        group: {
          key: groupKey,
          slug: groupSlug,
          family,
          typeProduit,
          category1
        },
        // on stockera 1 image pour le groupe
        canonical: {
          ref: null,
          url: null,
          title: null,
          mainImage: null,
          mainImageUrl: null
        },
        // options dispo
        _optionSets: {
          formes: new Set(),
          genres: new Set(),
          longueurs: new Set(),
          blindages: new Set(),
          contacts: new Set(),
          standards: new Set(),
          ips: new Set()
        },
        // variants regroupés
        _variantBuckets: new Map(), // key -> { ... , items: [] }
        // pour savoir si on a déjà un candidat image
        _hasCanonicalCandidate: false
      });
    }

    const pre = {
      ref: extractRefFromUrl(url), // souvent OK
      url,
      title: null, // rempli si on fetch
      family,
      category1,
      typeProduit,
      forme: parseFormeFromUrl(url),
      genres: parseGenresFromUrl(url), // ["male"], ["femelle"], ["unknown"], ou ["male","femelle"]
      blindage: parseBlindageFromUrl(url),
      contacts: parseContactsFromUrl(url),
      standard: parseStandardFromUrl(url),
      longueur: parseLongueurFromUrl(url),
      ip: parseIpFromUrl(url),
      flags: {
        versionCourte: url.toLowerCase().includes("version-courte"),
        aisg: url.toLowerCase().includes("aisg"),
        contactsSepares: url.toLowerCase().includes("doivent-etre-commandes-separement")
      }
    };

    const g = groups.get(groupKey);

    // options (pré)
    addToSetMap(g._optionSets, "formes", pre.forme);
    for (const gen of pre.genres) addToSetMap(g._optionSets, "genres", gen);
    addToSetMap(g._optionSets, "longueurs", pre.longueur);
    addToSetMap(g._optionSets, "blindages", pre.blindage);
    addToSetMap(g._optionSets, "contacts", pre.contacts);
    addToSetMap(g._optionSets, "standards", pre.standard);
    addToSetMap(g._optionSets, "ips", pre.ip);

    // variants (pré) — pas de "mixte": si 2 genres, on duplique
    const genresToEmit = pre.genres.length ? pre.genres.filter((x) => x !== "unknown") : [];
    const genresFinal = genresToEmit.length ? genresToEmit : ["unknown"];

    for (const genre of genresFinal) {
      const v = {
        ref: pre.ref,
        url: pre.url,
        contacts: pre.contacts,
        standard: pre.standard,
        genre,
        blindage: pre.blindage,
        forme: pre.forme,
        longueur: pre.longueur,
        ip: pre.ip,
        flags: pre.flags
      };

      const k = variantKey(v);
      if (!g._variantBuckets.has(k)) {
        g._variantBuckets.set(k, {
          key: k,
          forme: v.forme,
          genre: v.genre,
          longueur: v.longueur,
          blindage: v.blindage,
          contacts: v.contacts,
          standard: v.standard,
          ip: v.ip,
          items: []
        });
      }
      g._variantBuckets.get(k).items.push({ ref: v.ref, url: v.url });
    }

    // canon: on choisit un candidat (même si on devra fetch plus tard pour image)
    if (!g._hasCanonicalCandidate) {
      g._hasCanonicalCandidate = true;
      g.canonical.ref = pre.ref;
      g.canonical.url = pre.url;
    }

    // si on manque d'infos: on met en file pour fetch (complétion)
    if (shouldFetchForUrl(pre)) fetchQueue.push({ url, groupKey });

    if ((i + 1) % 300 === 0) {
      console.log(`Pré-tri… ${i + 1}/${urls.length} URLs analysées`);
    }
  }

  console.log(`✅ Pré-groupement terminé. Groupes: ${groups.size} | à compléter (fetch): ${fetchQueue.length}`);

  // --- 2) Fetch minimal: compléter les champs manquants, + récupérer 1 image par groupe ---
  // Stratégie:
  // - On fetch les URLs de fetchQueue (complétion)
  // - On s'assure qu'on a au moins 1 page fetch par groupe pour télécharger l'image du groupe
  const groupsNeedingImage = new Set(Array.from(groups.keys()));

  let fetchedPages = 0;
  let skippedNoRef = 0;

  // helper pour injecter des infos de page dans les buckets/options
  function applyPageDataToGroup(groupKey, url, pageData) {
    const g = groups.get(groupKey);
    if (!g) return;

    // canonical image (si pas encore)
    if (!g.canonical.mainImage && pageData.mainImageUrl) {
      // on télécharge UNE image par groupe, nommée par slug groupe
      const ext = getImageExtensionFromUrl(pageData.mainImageUrl);
      const imgFilename = `${g.group.slug}${ext}`;
      const imgDest = path.join(IMG_DIR, imgFilename);

      return downloadToFile(pageData.mainImageUrl, imgDest)
        .then(() => {
          g.canonical.mainImage = `produits/connecteur/img/${imgFilename}`;
          g.canonical.mainImageUrl = pageData.mainImageUrl;
          if (!g.canonical.title) g.canonical.title = pageData.title || null;
          if (!g.canonical.ref) g.canonical.ref = pageData.ref || null;
          if (!g.canonical.url) g.canonical.url = url;
          groupsNeedingImage.delete(groupKey);
        })
        .catch((e) => {
          console.warn(`  ⚠️ Image download failed for group ${groupKey}: ${e.message}`);
        });
    }
  }

  // On va faire un set pour ne pas refetch deux fois la même URL
  const alreadyFetched = new Set();

  // 2a) D'abord, fetch de complétion
  for (let i = 0; i < fetchQueue.length; i++) {
    const { url, groupKey } = fetchQueue[i];
    if (alreadyFetched.has(url)) continue;
    alreadyFetched.add(url);

    console.log(`[FETCH ${i + 1}/${fetchQueue.length}] ${url}`);

    const html = await fetchText(url);
    const $ = cheerio.load(html);

    const title = clean($("h1").first().text()) || null;

    const secA = extractSectionsBinderAccordion($);
    const secB = extractTechnicalTablesFallback($);
    const sections = mergeSections(secA, secB);

    let ref = refFromSections(sections) || extractRefFromText($) || extractRefFromUrl(url);
    if (!ref) {
      // On ne jette pas toute l'URL : mais pour ton besoin de variantes, une ref est utile.
      skippedNoRef++;
      // on peut quand même récupérer l'image si possible
    }

    const mainImageUrl = extractMainImageUrl($, url);

    // complétion via texte
    const bodyText = clean($("body").text());
    const parsedText = parseFromTextForFields(`${title || ""} ${bodyText}`);

    // reconstruire une “variant” depuis page (plus fiable)
    const pageVariantBase = {
      ref: ref || extractRefFromUrl(url),
      url,
      contacts: parsedText.contacts,
      standard: parsedText.standard,
      genres: parsedText.genres,
      blindage: parsedText.blindage,
      forme: parsedText.forme,
      longueur: parsedText.longueur,
      ip: parsedText.ip,
      flags: {
        versionCourte: url.toLowerCase().includes("version-courte"),
        aisg: url.toLowerCase().includes("aisg"),
        contactsSepares: url.toLowerCase().includes("doivent-etre-commandes-separement")
      }
    };

    const g = groups.get(groupKey);
    if (g) {
      // options sets (complétés)
      addToSetMap(g._optionSets, "formes", pageVariantBase.forme);
      for (const gen of pageVariantBase.genres) addToSetMap(g._optionSets, "genres", gen);
      addToSetMap(g._optionSets, "longueurs", pageVariantBase.longueur);
      addToSetMap(g._optionSets, "blindages", pageVariantBase.blindage);
      addToSetMap(g._optionSets, "contacts", pageVariantBase.contacts);
      addToSetMap(g._optionSets, "standards", pageVariantBase.standard);
      addToSetMap(g._optionSets, "ips", pageVariantBase.ip);

      // IMPORTANT: on “ajoute” aussi les variants complétés
      // (ça peut faire doublon avec le pré-ajout; pour éviter d'exploser, on déduplique par ref+url)
      const genresToEmit = pageVariantBase.genres.length
        ? pageVariantBase.genres.filter((x) => x !== "unknown")
        : [];
      const genresFinal = genresToEmit.length ? genresToEmit : ["unknown"];

      for (const genre of genresFinal) {
        const v = {
          ref: pageVariantBase.ref,
          url: pageVariantBase.url,
          contacts: pageVariantBase.contacts,
          standard: pageVariantBase.standard,
          genre,
          blindage: pageVariantBase.blindage,
          forme: pageVariantBase.forme,
          longueur: pageVariantBase.longueur,
          ip: pageVariantBase.ip,
          flags: pageVariantBase.flags
        };

        const k = variantKey(v);
        if (!g._variantBuckets.has(k)) {
          g._variantBuckets.set(k, {
            key: k,
            forme: v.forme,
            genre: v.genre,
            longueur: v.longueur,
            blindage: v.blindage,
            contacts: v.contacts,
            standard: v.standard,
            ip: v.ip,
            items: []
          });
        }

        // dédup items
        const bucket = g._variantBuckets.get(k);
        const id = `${v.ref || ""}__${v.url}`;
        if (!bucket._seen) bucket._seen = new Set();
        if (!bucket._seen.has(id)) {
          bucket._seen.add(id);
          bucket.items.push({ ref: v.ref, url: v.url });
        }
      }

      // image group si possible
      await applyPageDataToGroup(groupKey, url, {
        ref,
        title,
        mainImageUrl
      });
    }

    fetchedPages++;
    await sleep(DELAY_MS);
  }

  // 2b) Ensuite, garantir 1 image par groupe (si pas déjà)
  // On fetch la canonical URL de chaque groupe qui n'a pas encore d'image.
  const keysNeedingImage = Array.from(groupsNeedingImage);
  console.log(`Groupes sans image après complétion: ${keysNeedingImage.length}`);

  for (let i = 0; i < keysNeedingImage.length; i++) {
    const groupKey = keysNeedingImage[i];
    const g = groups.get(groupKey);
    if (!g) continue;
    if (g.canonical.mainImage) continue;

    const url = g.canonical.url;
    if (!url) continue;

    // si on a déjà fetch cette url, on ne la refetch pas (mais on n'a peut-être pas eu l'image)
    if (alreadyFetched.has(url)) continue;

    console.log(`[IMG ${i + 1}/${keysNeedingImage.length}] ${groupKey} -> ${url}`);

    const html = await fetchText(url);
    const $ = cheerio.load(html);

    const title = clean($("h1").first().text()) || null;

    const secA = extractSectionsBinderAccordion($);
    const secB = extractTechnicalTablesFallback($);
    const sections = mergeSections(secA, secB);

    let ref = refFromSections(sections) || extractRefFromText($) || extractRefFromUrl(url) || null;

    const mainImageUrl = extractMainImageUrl($, url);

    await applyPageDataToGroup(groupKey, url, {
      ref,
      title,
      mainImageUrl
    });

    fetchedPages++;
    await sleep(DELAY_MS);
  }

  // --- 3) Écriture: 1 JSON par GROUPE + 1 index.json ---
  const indexGroups = [];

  for (const [groupKey, g] of groups.entries()) {
    // finalize availableOptions
    const availableOptions = {
      formes: finalizeOptionSet(g._optionSets.formes),
      genres: finalizeOptionSet(g._optionSets.genres).filter((x) => x !== "mixte"), // sécurité
      longueurs: finalizeOptionSet(g._optionSets.longueurs),
      blindages: finalizeOptionSet(g._optionSets.blindages),
      contacts: finalizeOptionSet(g._optionSets.contacts),
      standards: finalizeOptionSet(g._optionSets.standards),
      ips: finalizeOptionSet(g._optionSets.ips)
    };

    // variants array (buckets)
    const variants = Array.from(g._variantBuckets.values()).map((b) => {
      // on retire _seen si présent
      const { _seen, ...rest } = b;
      return rest;
    });

    // JSON final du groupe
    const data = {
      generatedAt: new Date().toISOString(),
      group: g.group,
      availableOptions,
      canonical: g.canonical,
      variants
    };

    const jsonFilename = `${g.group.slug}.json`;
    const jsonPath = path.join(OUT_DIR, jsonFilename);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");

    indexGroups.push({
      group: g.group,
      file: `produits/connecteur/fiche/${jsonFilename}`,
      mainImage: g.canonical.mainImage || null,
      countVariants: variants.length
    });
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        groupsCount: indexGroups.length,
        fetchedPages,
        skippedNoFamily,
        skippedNoRef,
        families: FAMILY_PREFIXES.map((x) => x.family),
        groups: indexGroups
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(
    `✅ Terminé. Groupes exportés: ${indexGroups.length} | Pages fetch: ${fetchedPages} | noRef skipped: ${skippedNoRef}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});