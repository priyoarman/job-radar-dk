import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/lib/html";
import { parseTeamtailorFeed } from "../src/sources/teamtailor";

describe("htmlToText", () => {
  it("keeps paragraphs on separate lines", () => {
    expect(htmlToText("<p>Hello</p><p>World</p>")).toBe("Hello\nWorld");
  });

  it("keeps inline tags inside the same line", () => {
    expect(htmlToText("<p>We use <strong>TypeScript</strong> and <em>React</em>.</p>")).toBe(
      "We use TypeScript and React.",
    );
  });

  it("turns <br> into a line break", () => {
    expect(htmlToText("Line one<br>Line two<br/>Line three")).toBe("Line one\nLine two\nLine three");
  });

  it("turns list items into dashes", () => {
    expect(htmlToText("<h3>Stack</h3><ul><li>Node</li><li><span>Postgres</span></li></ul>")).toBe(
      "Stack\n- Node\n- Postgres",
    );
  });

  it("keeps the dash when a list item wraps its text in a paragraph", () => {
    expect(
      htmlToText('<ul><li class="MsoNormal"><p><span>Build features</span></p></li><li><p>Fix bugs</p></li></ul>'),
    ).toBe("- Build features\n- Fix bugs");
  });

  it("joins two paragraphs inside one list item with a space", () => {
    expect(htmlToText("<ul><li><p>Node</p><p>and Deno</p></li></ul>")).toBe("- Node and Deno");
  });

  it("keeps nested lists as separate items", () => {
    expect(htmlToText("<ul><li>Backend<ul><li>Node</li></ul></li></ul>")).toBe("- Backend\n- Node");
  });

  it("drops empty list items", () => {
    expect(htmlToText("<ul><li></li><li> </li><li>Real</li></ul>")).toBe("- Real");
  });

  it("decodes entities and treats &nbsp; as a normal space", () => {
    expect(htmlToText("<p>R&amp;D&nbsp;&nbsp;team</p>")).toBe("R&D team");
  });

  it("collapses spaces, tabs and blank lines", () => {
    expect(htmlToText("<p>  a \t  b  </p>\n\n\n<p></p><div>   </div><p>c</p>")).toBe("a b\nc");
  });

  it("drops scripts and styles", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Job</p><script>alert(1)</script>")).toBe("Job");
  });

  it("keeps link text and drops the URL", () => {
    expect(htmlToText('<p>Read <a href="https://example.com">our blog</a></p>')).toBe("Read our blog");
  });

  it("puts table cells on one line with spaces", () => {
    expect(htmlToText("<table><tr><td>Salary</td><td>Competitive</td></tr></table>")).toBe(
      "Salary Competitive",
    );
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("<p> </p>")).toBe("");
  });

  it("leaves plain text alone", () => {
    expect(htmlToText("Just text")).toBe("Just text");
  });

  it("cleans every real Teamtailor description", () => {
    const fixtures = ["lunar.rss", "templafy.rss", "formalize.rss"];
    const descriptions = fixtures.flatMap((name) =>
      parseTeamtailorFeed(
        readFileSync(resolve(import.meta.dirname, "fixtures/teamtailor", name), "utf8"),
      ).map((item) => item.description ?? ""),
    );
    expect(descriptions).toHaveLength(34);
    for (const html of descriptions) {
      const text = htmlToText(html);
      expect(text.length).toBeGreaterThan(100);
      expect(text).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(text).not.toMatch(/&(amp|nbsp|lt|gt);/);
      expect(text).not.toMatch(/ {2}|\n\n| /);
    }
  });
});
