import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";

const BASE = "https://www.binder-connector.com";
const SITEMAP_INDEX = `${BASE}/fr/sitemap.xml`;

const OUT_DIR = path.resolve("produits/connecteur/fiche");
const IMG_DIR = path.resolve("produits/connecteur/img");

const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS || 0);
const DELAY_MS = Number(process.env.DELAY_MS || 120);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}

async function downloadImage(url, destPath) {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
  } catch (e) {
    console.warn("Image download failed:", url);
  }
}

function clean(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function slugRef(ref) {
  return clean(ref).replace(/\s+/g, "-");
}

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function cleanup() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });

  console.log("Nettoyage JSON + images");

  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith(".json")) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  for (const f of fs.readdirSync(IMG_DIR)) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(f)) {
      fs.unlinkSync(path.join(IMG_DIR, f));
    }
  }
}

async function getAllProductUrlsFromSitemap() {
  const indexXml = await fetchText(SITEMAP_INDEX);
  const indexObj = await parseStringPromise(indexXml);

  const sitemapUrls = indexObj.sitemapindex.sitemap
    .map((s) => s.loc[0])
    .filter((u) => u.includes("sitemap=products"));

  const urls = [];

  for (const sm of sitemapUrls) {
    const xml = await fetchText(sm);
    const obj = await parseStringPromise(xml);
    urls.push(...obj.urlset.url.map((u) => u.loc[0]));
    await sleep(DELAY_MS);
  }

  return Array.from(new Set(urls));
}

function extractCategory1FromUrl(productUrl) {
  const u = new URL(productUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("produits");
  return i !== -1 ? parts[i + 1] ?? null : null;
}

function extractSections($) {
  const sections = {};

  $(".accordion__header").each((_, header) => {
    const title = clean($(header).text()).replace(/\b(Plus|less)\b/gi, "").trim();
    if (!title) return;

    const container = $(header).closest(".accordion__item");
    const table = container.find("table").first();
    if (!table.length) return;

    const kv = {};
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

    if (Object.keys(kv).length) sections[title] = kv;
  });

  return sections;
}

function extractMainImage($, pageUrl) {
  let found = null;

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    const text = clean($(a).text());
    if (!href) return;

    const abs = href.startsWith("http")
      ? href
      : new URL(href, pageUrl).toString();

    if (/télécharger l’image/i.test(text) && /\.jpe?g$/i.test(abs)) {
      found = abs;
      return false;
    }
  });

  return found;
}

async function main() {
  cleanup();

  let productUrls = await getAllProductUrlsFromSitemap();
  if (MAX_PRODUCTS > 0) productUrls = productUrls.slice(0, MAX_PRODUCTS);

  console.log(`Produits: ${productUrls.length}`);

  const indexItems = [];

  for (let i = 0; i < productUrls.length; i++) {
    const url = productUrls[i];
    console.log(`[${i + 1}/${productUrls.length}] ${url}`);

    const html = await fetchText(url);
    const $ = cheerio.load(html);

    const title = clean($("h1").first().text()) || null;
    const category1 = extractCategory1FromUrl(url);

    const sections = extractSections($);

    let ref = null;
    for (const kv of Object.values(sections)) {
      if (kv["Référence"]) {
        ref = kv["Référence"];
        break;
      }
    }

    const mainImageUrl = extractMainImage($, url);

    let localImagePath = null;

    if (mainImageUrl) {
      const fileName = ref
        ? `${slugRef(ref)}.jpg`
        : `${sha1(url)}.jpg`;

      const dest = path.join(IMG_DIR, fileName);
      await downloadImage(mainImageUrl, dest);
      localImagePath = `produits/connecteur/img/${fileName}`;
    }

    const data = {
      ref,
      title,
      url,
      category1,
      mainImage: localImagePath,
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
      mainImage: localImagePath,
      file: `produits/connecteur/fiche/${fileBase}.json`,
    });

    await sleep(DELAY_MS);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: indexItems.length,
        items: indexItems,
      },
      null,
      2
    )
  );

  console.log("✅ Terminé.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});