import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

const OUT_DIR = path.resolve("produits/connecteur/fiche"); // groupes
const IMG_DIR = path.resolve("produits/connecteur/img");   // 1 image/groupe

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
 * ✅ FILTRE familles AVANT crawl (ça tu gardes)
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

// -------------------------
// ✅ Parsing UNIQUEMENT depuis la page
// -------------------------

function slugify(s) {
  return clean(s)
    .toLowerCase()
    .replace(/[’']/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeTextForSearch(s) {
  return clean(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Trouve une valeur dans sections avec plusieurs clés possibles
function pickFirstSectionValue(sections, keys) {
  const wanted = new Set(keys.map(k => normalizeTextForSearch(k)));
  for (const kv of Object.values(sections || {})) {
    if (!kv) continue;
    for (const [k, v] of Object.entries(kv)) {
      if (wanted.has(normalizeTextForSearch(k))) return clean(v);
    }
  }
  return null;
}

function parseIPFromSections(sections) {
  const v =
    pickFirstSectionValue(sections, ["Indice de protection", "Indice de Protection", "IP"]) ||
    null;
  if (!v) return "unknown";
  const m = normalizeTextForSearch(v).match(/\bip\s*([0-9]{2})\b/);
  return m ? `ip${m[1]}` : "unknown";
}

function parseStandardFromSections(sections) {
  const v = pickFirstSectionValue(sections, ["Norme de conception", "Norme", "Standard"]);
  return v ? v : "unknown";
}

function parseGenreFormeFromDesign(design) {
  const s = normalizeTextForSearch(design || "");

  const genre =
    s.includes("femelle") ? "femelle" :
    (s.includes("male") || s.includes("male") || s.includes("male") || s.includes("mle") || s.includes("male")) ? "male" :
    (s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male")) ? "male" :
    (s.includes("male") || s.includes("male") || s.includes("male") || s.includes("male")) ? "male" :
    (s.includes("male") || s.includes("male") || s.includes("male")) ? "male" :
    (s.includes("male") || s.includes("male")) ? "male" :
    (s.includes("male")) ? "male" :
    (s.includes("male")) ? "male" :
    (s.includes("male")) ? "male" :
    "unknown";

  // forme
  const forme =
    (s.includes("coud") || s.includes("angle")) ? "coude" :
    s.includes("droit") ? "droit" :
    "unknown";

  return { genre, forme };
}

function parseBlindageFromSectionsOrTitle(sections, title) {
  const t = normalizeTextForSearch(title || "");
  const blob = normalizeTextForSearch(JSON.stringify(sections || {}));

  const hasNonBlinde = t.includes("non blinde") || blob.includes("non blinde");
  const hasBlinde = t.includes("blinde") || blob.includes("blinde") || t.includes("blindable") || blob.includes("blindable");

  if (hasNonBlinde) return "non-blinde";
  if (hasBlinde) return "blinde";
  return "unknown";
}

function parseContactsFromPage($, sections, title) {
  // 1) Si binder affiche la liste "Nombre de contacts disponibles" en pastilles
  // On récupère tous les nombres au début de chaque pastille (ex: "2 (02-a)" => 2)
  const contactsSet = new Set();
  const pillsText = $("body").text(); // pas parfait mais marche
  const pillMatches = pillsText.match(/\b(\d{1,2})\s*\(\s*\d{2}-[a-z]\s*\)/gi);
  if (pillMatches) {
    for (const m of pillMatches) {
      const n = m.match(/\b(\d{1,2})\b/);
      if (n) contactsSet.add(Number(n[1]));
    }
  }

  // 2) Sinon, dans title "Contacts: 2 (02-a)" ou "Contacts: 4+FE"
  const t = normalizeTextForSearch(title || "");
  let mm = t.match(/contacts?\s*:\s*(\d{1,2})/);
  if (mm) contactsSet.add(Number(mm[1]));

  // 3) Sinon, dans sections
  const secStr = normalizeTextForSearch(JSON.stringify(sections || {}));
  mm = secStr.match(/contacts?\s*:\s*(\d{1,2})/);
  if (mm) contactsSet.add(Number(mm[1]));

  if (contactsSet.size === 0) return { contacts: null, contactsDisponibles: [] };

  // contacts de la variante = si title donne un chiffre, on le prend, sinon plus petit (arbitraire)
  const contactsVariant = mm ? Number(mm[1]) : Math.min(...contactsSet);

  return { contacts: contactsVariant, contactsDisponibles: Array.from(contactsSet).sort((a,b)=>a-b) };
}

// Longueur: on ne “liste” pas, on détecte des patterns d’unités dans les champs pertinents
function parseLongueurFromSections(sections, title) {
  // on privilégie les champs qui contiennent réellement une longueur
  const candidates = [
    pickFirstSectionValue(sections, ["Passage de câble", "Passage de cable"]),
    pickFirstSectionValue(sections, ["Longueur de câble", "Longueur de cable"]),
    pickFirstSectionValue(sections, ["Câble", "Cable"]),
    pickFirstSectionValue(sections, ["Section de raccordement"]), // parfois AWG + mm² (pas une longueur, mais on ne va pas l’utiliser si pas de mm/m)
  ].filter(Boolean);

  // Ajout title en fallback
  if (title) candidates.push(title);

  // Regex générique mm: "6,0-8,0 mm" / "6.0 - 8.0 mm"
  const reRangeMm = /(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*mm/i;
  // Regex générique m: "2 m"
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
 * ✅ typeProduit depuis le H1 (page) et UNIQUEMENT à partir des options extraites.
 * On retire dynamiquement ce qu’on sait être des options :
 * - segment Contacts...
 * - IPxx
 * - longueur (range mm / Xm)
 * - genre/forme/blindage/standard s’ils apparaissent textuellement
 *
 * Pas de parsing d’URL pour les caractéristiques.
 */
function computeTypeProduitFromTitle(title, { genre, forme, blindage, standard, longueur, ip }) {
  let s = clean(title || "");
  if (!s) return "unknown";

  const ns = normalizeTextForSearch(s);

  // 1) Retire tout segment "Contacts: ...", car c’est option
  // Exemple: "..., Contacts: 2 (02-a), 6,0-8,0 mm, ..."
  s = s.replace(/,\s*Contacts?\s*:\s*[^,]+/gi, "");

  // 2) Retire IPxx
  s = s.replace(/\bIP\s*\d{2}\b/gi, "");

  // 3) Retire longueur si on l’a trouvée
  if (longueur && longueur !== "unknown") {
    const l = longueur.replace(".", "\\.").replace("-", "\\-");
    // on retire la chaîne telle quelle si elle apparait
    s = s.replace(new RegExp(l, "gi"), "");
  }
  // et on retire de toute façon les patterns length génériques
  s = s.replace(/\b\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*mm\b/gi, "");
  s = s.replace(/\b\d{1,3}\s*m\b/gi, "");

  // 4) Retire standard si il est présent dans le title
  if (standard && standard !== "unknown") {
    const st = standard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(st, "gi"), "");
  }

  // 5) Retire blindage/genre/forme si présents textuellement
  // (ici ce n’est pas une “liste”, on retire les VALEURS qu’on a extraites)
  const removeIfPresent = (val) => {
    if (!val || val === "unknown") return;
    const vv = normalizeTextForSearch(val);
    // on enlève en mode “mots”, pas substrings hasardeux
    // ex: "non-blinde" -> "non blinde"
    const pattern = vv.replace(/-/g, "\\s*");
    s = s.replace(new RegExp(`\\b${pattern}\\b`, "gi"), "");
  };

  removeIfPresent(genre);
  removeIfPresent(forme);
  removeIfPresent(blindage);

  // 6) Nettoyage final : on enlève UL/EN/IEC etc qui peuvent rester en fin (sans lister de vocabulaire produit)
  // Ici on ne retire que des motifs “norme” génériques (lettres + chiffres)
  s = s.replace(/\b(ul|en|iec|din)\s*\d[\d\s\-]*/gi, "");

  // 7) On prend une base stable : souvent tout avant le premier gros séparateur restant
  // Mais sans être brutal : on garde tout, puis slugify.
  const out = slugify(s);

  // Si c’est vide, fallback simple
  return out || "unknown";
}

function pickBestCanonicalVariant(variants) {
  const withImg = variants.find(v => v.mainImageUrl);
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
    if (!ref) {
      console.warn("  ❌ Ref introuvable => skip");
      skippedNoRef++;
      await sleep(DELAY_MS);
      continue;
    }

    // --- Options depuis PAGE ---
    const design = pickFirstSectionValue(sections, ["Design du connecteur", "Design"]) || title || "";
    const { genre, forme } = parseGenreFormeFromDesign(design);
    const blindage = parseBlindageFromSectionsOrTitle(sections, title);
    const standard = parseStandardFromSections(sections);
    const ip = parseIPFromSections(sections);

    const longueur = parseLongueurFromSections(sections, title);

    const { contacts, contactsDisponibles } = parseContactsFromPage($, sections, title);

    const mainImageUrl = extractMainImageUrl($, url) || null;

    // ✅ typeProduit depuis TITLE (page) et UNIQUEMENT options extraites
    const typeProduit = computeTypeProduitFromTitle(title, { genre, forme, blindage, standard, longueur, ip });

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
          ips: new Set(),
          contactsDisponibles: new Set()
        },
        canonical: null,
        variants: []
      });
    }

    const g = groups.get(groupKey);

    g.availableOptions.longueurs.add(longueur || "unknown");
    g.availableOptions.formes.add(forme || "unknown");
    g.availableOptions.genres.add(genre || "unknown");
    g.availableOptions.blindages.add(blindage || "unknown");
    g.availableOptions.standards.add(standard || "unknown");
    g.availableOptions.ips.add(ip || "unknown");
    if (typeof contacts === "number") g.availableOptions.contacts.add(contacts);
    for (const c of contactsDisponibles) g.availableOptions.contactsDisponibles.add(c);

    g.variants.push({
      ref,
      url,
      title,
      // options
      longueur,
      forme,
      genre,
      blindage,
      contacts,
      standard,
      ip,
      contactsDisponibles,
      // image
      mainImageUrl,
      // tu gardes les sections si tu veux encore du détail
      sections
    });

    await sleep(DELAY_MS);
  }

  // Écriture groupes + 1 image par groupe
  const indexGroups = [];

  for (const [groupKey, g] of groups.entries()) {
    const availableOptions = {
      longueurs: Array.from(g.availableOptions.longueurs).sort(),
      formes: Array.from(g.availableOptions.formes).sort(),
      genres: Array.from(g.availableOptions.genres).sort(),
      blindages: Array.from(g.availableOptions.blindages).sort(),
      standards: Array.from(g.availableOptions.standards).sort(),
      ips: Array.from(g.availableOptions.ips).sort(),
      contacts: Array.from(g.availableOptions.contacts).sort((a, b) => a - b),
      contactsDisponibles: Array.from(g.availableOptions.contactsDisponibles).sort((a, b) => a - b)
    };

    const canonicalVariant = pickBestCanonicalVariant(g.variants);

    let mainImageLocal = null;
    let chosenImageUrl = canonicalVariant?.mainImageUrl || null;

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
      // variants = uniquement ce que tu veux + sections si tu veux encore
      variants: g.variants.map(v => ({
        ref: v.ref,
        url: v.url,
        title: v.title,
        longueur: v.longueur,
        forme: v.forme,
        genre: v.genre,
        blindage: v.blindage,
        contacts: v.contacts,
        contactsDisponibles: v.contactsDisponibles,
        standard: v.standard,
        ip: v.ip
      }))
    };

    const jsonFilename = `${g.group.slug}.json`;
    const jsonPath = path.join(OUT_DIR, jsonFilename);
    fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), "utf-8");

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