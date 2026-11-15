import * as cheerio from "cheerio";

const BLOCK_TAGS =
  "p, div, section, article, header, footer, h1, h2, h3, h4, h5, h6, ul, ol, table, tr, blockquote, pre, hr";

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);

  $("script, style, noscript, template").remove();
  $("br").replaceWith("\n");
  $("li p, li div").each((_, el) => {
    $(el).replaceWith(` ${$(el).html() ?? ""} `);
  });
  $("li").each((_, el) => {
    $(el).prepend("\n- ").append("\n");
  });
  $(BLOCK_TAGS).each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  $("td, th").append(" ");

  return $.root()
    .text()
    .split("\n")
    .map((line) => line.replace(/[\s ]+/g, " ").trim())
    .filter((line) => line !== "" && line !== "-")
    .join("\n");
}
