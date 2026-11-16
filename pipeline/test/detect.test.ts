import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/lib/http";
import { careersLinks, detectBoards, detectCompany } from "../src/tools/detect";

const fixture = (path: string) => readFileSync(resolve(import.meta.dirname, "fixtures", path), "utf8");
const PAGE = "https://www.example.dk/";

describe("detectBoards", () => {
  it.each([
    ['<a href="https://acme.teamtailor.com/jobs">Jobs</a>', "TEAMTAILOR", "https://acme.teamtailor.com"],
    ['<script src="https://scripts.teamtailor-cdn.com/widget.js"></script>', "TEAMTAILOR", "https://www.example.dk"],
    ['<a href="https://boards.greenhouse.io/acme">Jobs</a>', "GREENHOUSE", "acme"],
    ['<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>', "GREENHOUSE", "acme"],
    ['<a href="https://job-boards.eu.greenhouse.io/acme/jobs/123">Job</a>', "GREENHOUSE", "acme"],
    ['<a href="https://jobs.lever.co/acme/abc">Job</a>', "LEVER", "acme"],
    ['<a href="https://jobs.eu.lever.co/acme">Jobs</a>', "LEVER_EU", "eu:acme"],
    ['<a href="https://jobs.ashbyhq.com/Acme">Jobs</a>', "ASHBY", "Acme"],
    ['<a href="https://apply.workable.com/acme/">Jobs</a>', "WORKABLE", "acme"],
    ['<a href="https://acme.recruitee.com/o/dev">Job</a>', "RECRUITEE", "acme"],
    ['<a href="https://acme.wd3.myworkdayjobs.com/en-US/Acme_Careers">Jobs</a>', "WORKDAY", "https://acme.wd3.myworkdayjobs.com/Acme_Careers"],
    ['<link href="https://rmkcdn.successfactors.com/abc/main.css">', "SUCCESSFACTORS", "https://www.example.dk"],
    ['<iframe src="https://acme.career.emply.com/ad/dev/123"></iframe>', "EMPLY", "https://acme.career.emply.com/ad/dev/123"],
    ['<a href="https://careers.smartrecruiters.com/Acme1">Jobs</a>', "SMARTRECRUITERS", "Acme1"],
    ['<a href="https://acme.jobs.personio.de/">Jobs</a>', "PERSONIO", "acme"],
    ['<script type="application/ld+json">{"@type": "JobPosting"}</script>', "JSONLD", PAGE],
  ])("finds %s", (html, system, key) => {
    expect(detectBoards(html, PAGE)).toContainEqual(expect.objectContaining({ system, key }));
  });

  it("ignores generic paths like greenhouse.io/embed or teamtailor www", () => {
    expect(detectBoards('<a href="https://boards.greenhouse.io/embed">x</a><a href="https://www.teamtailor.com">x</a>', PAGE)).toEqual([]);
  });

  it("marks only the systems we can read as supported", () => {
    const html = '<a href="https://jobs.lever.co/acme">a</a><a href="https://acme.jobs.personio.de">b</a>';
    expect(detectBoards(html, PAGE).map((d) => [d.system, d.supported])).toEqual([
      ["LEVER", true],
      ["PERSONIO", false],
    ]);
  });

  it("finds nothing on a page without job boards", () => {
    expect(detectBoards("<html><body>Welcome</body></html>", PAGE)).toEqual([]);
  });
});

describe("careersLinks", () => {
  it("finds careers links by path and by text, best first, without duplicates", () => {
    const html = `
      <a href="/about">About us</a>
      <a href="/karriere">Karriere</a>
      <a href="/karriere#top">Karriere</a>
      <a href="https://acme.teamtailor.com">Work with us</a>
      <a href="/join-us">Join us</a>
      <a href="mailto:jobs@example.dk">Mail</a>`;
    expect(careersLinks(html, PAGE)).toEqual([
      "https://www.example.dk/karriere",
      "https://www.example.dk/join-us",
      "https://acme.teamtailor.com/",
    ]);
  });

  it("returns nothing when there is no careers link", () => {
    expect(careersLinks('<a href="/products">Products</a>', PAGE)).toEqual([]);
  });
});

function site(routes: Record<string, string | number>) {
  const text = vi.fn(async (url: string) => {
    const route = routes[url];
    if (route === undefined || typeof route === "number") throw new HttpError(url, typeof route === "number" ? route : 404);
    return route;
  });
  return { text, json: vi.fn(async (url: string) => JSON.parse(await text(url))) };
}

describe("detectCompany", () => {
  const company = { id: 1, name: "Trustpilot", category: "saas", claimed: ["CUSTOM"], claimedUrl: null, website: "https://www.example.dk/" };

  it("follows the careers link, finds the board and checks it with the real adapter", async () => {
    const http = site({
      "https://www.example.dk/robots.txt": "User-agent: *\nDisallow: /admin/",
      "https://www.example.dk/": '<a href="/careers">Careers</a>',
      "https://www.example.dk/careers": '<script src="https://boards.greenhouse.io/embed/job_board/js?for=trustpilot"></script>',
      "https://boards-api.greenhouse.io/v1/boards/trustpilot/jobs?content=true": fixture("greenhouse/trustpilot.json"),
    });
    const result = await detectCompany(company, http);
    expect(result).toMatchObject({ status: "confirmed", system: "GREENHOUSE", sourceKey: "trustpilot", counts: { jobs: 29 } });
    expect(result.pages).toEqual(["https://www.example.dk/", "https://www.example.dk/careers"]);
  });

  it("reads robots.txt once per site and respects it for every page", async () => {
    const http = site({
      "https://www.example.dk/robots.txt": "User-agent: *\nDisallow: /careers",
      "https://www.example.dk/": '<a href="/careers">Careers</a>',
    });
    const result = await detectCompany(company, http);
    expect(result.status).toBe("blocked");
    expect(http.text.mock.calls.filter(([url]) => url.endsWith("/robots.txt"))).toHaveLength(1);
    expect(http.text.mock.calls.some(([url]) => url === "https://www.example.dk/careers")).toBe(false);
  });

  it("does not read the start page when robots.txt forbids it", async () => {
    const http = site({ "https://www.example.dk/robots.txt": "User-agent: *\nDisallow: /", "https://www.example.dk/": "<a>x</a>" });
    expect(await detectCompany(company, http)).toMatchObject({ status: "blocked", pages: [] });
  });

  it("reports a system we cannot read yet, with the address it found", async () => {
    const http = site({
      "https://www.example.dk/robots.txt": 404,
      "https://www.example.dk/": '<iframe src="https://acme.career.emply.com/vacancies"></iframe>',
    });
    expect(await detectCompany(company, http)).toMatchObject({ status: "unsupported", system: "EMPLY", sourceKey: "https://acme.career.emply.com/vacancies" });
  });

  it("reports a Workday board without requesting it, to avoid Workday's rate limits", async () => {
    const http = site({
      "https://www.example.dk/robots.txt": "",
      "https://www.example.dk/": '<a href="https://lego.wd103.myworkdayjobs.com/en-US/LEGO_External">Jobs</a>',
    });
    const result = await detectCompany(company, http);
    expect(result).toMatchObject({ status: "found-unverified", system: "WORKDAY", sourceKey: "https://lego.wd103.myworkdayjobs.com/LEGO_External" });
    expect(http.json).not.toHaveBeenCalled();
  });

  it("reports a found board whose check failed, with the reason", async () => {
    const http = site({
      "https://www.example.dk/robots.txt": "",
      "https://www.example.dk/": '<a href="https://jobs.lever.co/acme">Jobs</a>',
      "https://api.lever.co/v0/postings/acme?mode=json": 503,
    });
    const result = await detectCompany(company, http);
    expect(result).toMatchObject({ status: "found-unverified", system: "LEVER", sourceKey: "acme" });
    expect(result.note).toContain("503");
  });

  it("reports the company's own career page when it links to job pages", async () => {
    const http = site({
      "https://www.example.dk/robots.txt": "",
      "https://www.example.dk/": '<a href="/karriere/">Karriere</a><a href="/jobs/one/">One</a>',
      "https://www.example.dk/karriere/": '<a href="/jobs/one/">One</a><a href="/jobs/two/">Two</a><a href="/jobs/three/">Three</a>',
    });
    expect(await detectCompany(company, http)).toMatchObject({
      status: "found-custom",
      system: "CUSTOM",
      sourceKey: "https://www.example.dk/karriere/",
      note: "3 job links on the page; check it by hand",
    });
  });

  it("prefers a readable own career page over a system we cannot read", async () => {
    const http = site({
      "https://www.example.dk/robots.txt": "",
      "https://www.example.dk/": '<a href="https://candidate.hr-manager.net/Agent/Subscription.aspx?cid=333">Jobagent</a><a href="/jobs/a/">A</a><a href="/jobs/b/">B</a>',
    });
    expect(await detectCompany(company, http)).toMatchObject({ status: "found-custom", sourceKey: "https://www.example.dk/" });
  });

  it("needs at least two job links before suggesting a career page", async () => {
    const http = site({ "https://www.example.dk/robots.txt": "", "https://www.example.dk/": '<a href="/jobs/only-one/">Job</a>' });
    expect((await detectCompany(company, http)).status).toBe("nothing-found");
  });

  it("reports nothing-found when the site has no recognisable board", async () => {
    const http = site({ "https://www.example.dk/robots.txt": "", "https://www.example.dk/": "<p>Hello</p>" });
    expect((await detectCompany(company, http)).status).toBe("nothing-found");
  });

  it("reports an error when the website cannot be reached", async () => {
    const http = site({});
    expect((await detectCompany(company, http)).status).toBe("error");
  });
});
