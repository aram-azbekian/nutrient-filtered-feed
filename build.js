// build.js
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import { JSDOM } from "jsdom";
import crypto from "crypto";
import { writeFileSync } from "fs";

const SOURCE = process.env.SOURCE || "https://www.nutrient.io/blog/feed.xml";
const KEYWORD_SOURCE = process.env.KEYWORDS || "iOS,Objective-C,Swift,SwiftUI,Xcode";
const KEYWORDS = KEYWORD_SOURCE.split(",").map(s => s.trim()).filter(Boolean);
const KEYWORDS_LOWER = KEYWORDS.map(k => k.toLowerCase());
const repoOwner = process.env.OWNER
  || process.env.GITHUB_REPOSITORY?.split("/")?.[0]
  || "";
const defaultSelfUrl = repoOwner
  ? `https://${repoOwner}.github.io/nutrient-ios-swift.xml`
  : "https://localhost/nutrient-ios-swift.xml";
const SELF_URL = process.env.SELF_URL || defaultSelfUrl;
if (!process.env.SELF_URL && !repoOwner) {
  console.warn("SELF_URL not set; defaulting to https://localhost/nutrient-ios-swift.xml");
}
const FEED_TITLE = process.env.FEED_TITLE || "Nutrient Blog — iOS & Swift (filtered)";
const UA = "KeywordFeed/1.0 (+https://github.com/${repoOwner})";

const rfc822 = d => new Date(d).toUTCString();
const sha1 = s => crypto.createHash("sha1").update(s).digest("hex");
const asArray = x => Array.isArray(x) ? x : (x ? [x] : []);

const fetchText = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "*/*" }});
  if (!r.ok) throw new Error(`Fetch ${url} failed: ${r.status}`);
  return r.headers.get("content-type")?.includes("xml") ? await r.text() : await r.text();
};

const TAG_PREFIX = "/blog/tags/";

const extractArticleInfo = (html) => {
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    const scope = doc.querySelector("article") || doc.querySelector("main") || doc.body;
    const tagSlugs = Array.from(scope?.querySelectorAll(`a[href^="${TAG_PREFIX}"]`) || [])
      .map(a => (a.getAttribute("href") || "").trim())
      .map(href => {
        const rest = href.slice(TAG_PREFIX.length);
        const beforeQuery = rest.split(/[?#]/)[0];
        const segment = beforeQuery.split("/").filter(Boolean)[0] || "";
        return decodeURIComponent(segment).toLowerCase();
      })
      .filter(Boolean);
    return { tagSlugs };
  } finally {
    dom.window.close();
  }
};

const tagsMatch = (slugs) => slugs?.some(slug => KEYWORDS_LOWER.includes(slug)) || false;

const normalizeRssItems = (parsed) => {
  const ch = parsed?.rss?.channel?.[0];
  const items = asArray(ch?.item);
  return items.map(it => ({
    title: it.title?.[0] || "",
    link: it.link?.[0] || "",
    guid: (it.guid?.[0]?._ || it.guid?.[0]) || "",
    pubDate: it.pubDate?.[0] || "",
    description: it.description?.[0] || "",
    categories: asArray(it.category).map(c => (typeof c === "string" ? c : c?._)).filter(Boolean)
  }));
};

const rssItemXml = (i) => `
    <item>
      <title><![CDATA[${i.title}]]></title>
      <link>${i.link}</link>
      <guid isPermaLink="false">${i.guid}</guid>
      <pubDate>${i.pubDate}</pubDate>
      <description><![CDATA[${i.description || ""}]]></description>
      ${i.categories.map(c=>`<category>${c}</category>`).join("\n      ")}
    </item>`.trim();

const run = async () => {
  const xml = await fetchText(SOURCE);
  const parsed = await parseStringPromise(xml, { explicitArray: true, mergeAttrs: true });
  const items = normalizeRssItems(parsed);

  const filtered = [];
  for (const it of items) {
    if (!it.link) continue;
    try {
      const html = await fetchText(it.link);
      const { tagSlugs } = extractArticleInfo(html);
      if (tagsMatch(tagSlugs)) {
        filtered.push({
          ...it,
          guid: it.guid || `urn:guid:${sha1((it.link||"") + "|" + (it.title||""))}`,
          pubDate: /GMT|[+-]\d{4}/.test(it.pubDate) ? it.pubDate : rfc822(it.pubDate)
        });
      }
    } catch (e) {
      // skip items we can't fetch
      continue;
    }
  }

  const newest = filtered.length ? Math.max(...filtered.map(i => Date.parse(i.pubDate))) : Date.now();
  const out = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${FEED_TITLE}</title>
    <link>${SELF_URL}</link>
    <description>Filtered by content-only keywords: ${KEYWORDS.join(", ")}</description>
    <language>en</language>
    <lastBuildDate>${new Date(newest).toUTCString()}</lastBuildDate>
    <ttl>30</ttl>
    <atom:link href="${SELF_URL}" rel="self" type="application/rss+xml"/>
${filtered.map(rssItemXml).join("\n")}
  </channel>
</rss>\n`;
  writeFileSync("nutrient-ios-swift.xml", out, "utf8");
  console.log(`Wrote nutrient-ios-swift.xml with ${filtered.length} items`);
};

run().catch(err => { console.error(err); process.exit(1); });
