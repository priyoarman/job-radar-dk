import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { filterJob, normalizeTitle } from "../src/steps/filter";
import { parseTeamtailorFeed } from "../src/sources/teamtailor";

const realTitles: Array<[string, string | null]> = [
  ["Backend Engineer", null],
  ["Platform Engineer", null],
  ["Corporate Security Engineer", null],
  ["Compliance Product Enablement Student Assistant (French)", "title:entry-without-tech"],
  ["Senior Backend Engineer", "title:senior"],
  ["Senior Backend Engineer - Lending", "title:senior"],
  ["Senior Software Engineer", "title:senior"],
  ["Senior Security Engineer", "title:senior"],
  ["Senior Regulatory Data Engineer", "title:senior"],
  ["Staff Software Engineer - Marketplace", "title:staff"],
  ["Engineering Manager", "title:manager"],
  ["Product Manager / Senior Product Manager - Cards & Top-ups", "title:senior"],
  ["Head of Accounting", "title:head-of"],
  ["Head of FCP Operations", "title:head-of"],
  ["Director of Legal (Copenhagen)", "title:director"],
  ["Procurement Manager", "title:manager"],
  ["Treasury Manager", "title:manager"],
  ["Partner Manager - Norway", "title:manager"],
  ["Inside Account Executive", "title:no-dev-keyword"],
  ["Executive Sales, EMEA", "title:no-dev-keyword"],
  ["IT Support (Copenhagen)", "title:no-dev-keyword"],
  ["Office Caretaker (Aarhus)", "title:no-dev-keyword"],
  ["People Operations Partner", "title:no-dev-keyword"],
  ["Sales Development Representative - Norway", "title:no-dev-keyword"],
  ["Third Party Risk Specialist, ICT (DORA)", "title:no-dev-keyword"],
  ["Senior Compliance Officer/Compliance Officer", "title:senior"],
  ["Backend developer", null],
  ["Backend Developer", null],
  ["Full Stack Engineer", null],
  ["Data Engineer", null],
  ["Software Engineer, Online", null],
  ["Mainframe / COBOL-udvikler", null],
  ["Graduate Programme - Finance", "title:entry-without-tech"],
  ["Graduate Programme – Shipping", "title:entry-without-tech"],
  ["Intern", "title:entry-without-tech"],
  ["Internship: Direct Procurement", "title:entry-without-tech"],
  ["Internship: Procurement Technology, Sustainability & Operations", null],
  ["Junior Accountant", "title:entry-without-tech"],
  ["Junior Paid Social Specialist - Part-time", "title:entry-without-tech"],
  ["(Junior) Sales Medewerker Binnendienst", "title:entry-without-tech"],
  ["Local Financial Controller (Junior)", "title:entry-without-tech"],
  ["Heftruckchauffeur (certificaat intern te halen)", "title:entry-without-tech"],
  ["Working Student HR - People Operations (m/w/d)", "title:entry-without-tech"],
  ["Working Student Commercial (m/w/d)", "title:entry-without-tech"],
  ["Praktikant [Podads]", "title:entry-without-tech"],
];

const otherTitles: Array<[string, string | null]> = [
  ["AI Engineer", null],
  ["Maintenance Lead", "title:lead"],
  ["Maintenance Technician", "title:no-dev-keyword"],
  ["Full Stack Developer", null],
  ["Full-Stack Developer", null],
  ["Fullstack Developer", null],
  ["Front-end Developer", null],
  ["Back End Engineer", null],
  ["Junior Developer", null],
  ["Graduate Programme 2027 - Technology", null],
  ["Junior Data Analyst", null],
  ["Working Student Software Development (m/w/d)", null],
  ["IT Student", null],
  ["Student Assistant – Data & AI", null],
  ["Student Assistant, Web", null],
  ["Trainee – Cloud & DevOps", null],
  ["Make it happen – Junior Coordinator", "title:entry-without-tech"],
  ["Junior Programmer", null],
  ["Data Protection Officer", "title:no-dev-keyword"],
  ["IT Support (Copenhagen) Student", null],
  ["Softwarepraktikant", null],
  ["Software Engineering Intern", null],
  ["Internal Audit Specialist", "title:no-dev-keyword"],
  ["Tech Lead", "title:lead"],
  ["Sr. Developer", "title:sr"],
  ["Principal Engineer", "title:principal"],
  ["VP of Engineering", "title:vp"],
  ["Chief Technology Officer", "title:chief"],
  ["Director of Engineering", "title:director"],
  ["Studentermedhjælper – Udvikler", null],
  ["Studentermedhjælper til IT-afdelingen", null],
  ["Softwareudvikler", null],
  ["Systemudvikler med fokus på .NET", null],
  ["Seniorudvikler", "title:senior"],
  ["Ledende udvikler", "title:ledende"],
  ["Teamleder, udvikling", "title:leder"],
  ["Udviklingschef", "title:chef"],
  ["Praktikant – softwareudvikling", null],
  ["Udviklingspraktikant", "title:entry-without-tech"],
  ["Nyuddannet udvikler", null],
  ["Chef (køkken)", "title:chef"],
  ["Retail Assistant", "title:no-dev-keyword"],
  ["Maintainer", "title:no-dev-keyword"],
  ["Staffing Coordinator", "title:no-dev-keyword"],
];

describe("filterJob", () => {
  it.each([...realTitles, ...otherTitles])("%s → %s", (title, reason) => {
    const expected = reason === null ? { pass: true } : { pass: false, reason };
    expect(filterJob({ title })).toEqual(expected);
  });

  it("decides every real fixture title without crashing", () => {
    const fixtures = ["lunar.rss", "templafy.rss", "formalize.rss"];
    const titles = fixtures.flatMap((name) =>
      parseTeamtailorFeed(readFileSync(resolve(import.meta.dirname, "fixtures/teamtailor", name), "utf8")).map(
        (item) => item.title ?? "",
      ),
    );
    const passed = titles.filter((title) => filterJob({ title }).pass);
    expect(passed.sort()).toEqual(["Backend Engineer", "Corporate Security Engineer", "Platform Engineer"]);
  });
});

describe("normalizeTitle", () => {
  it.each([
    ["Full Stack", "fullstack"],
    ["full-stack", "fullstack"],
    ["FULL  STACK", "fullstack"],
    ["IT Full Stack", "IT fullstack"],
    ["Front-End", "frontend"],
    ["back end", "backend"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });
});

describe("filterJob with location", () => {
  it("keeps a dev job anywhere in Denmark, whatever the work mode", () => {
    for (const location of ["København, Denmark", "Aarhus, Denmark", "Remote - Denmark", "Herlev, Denmark; Berlin, Germany"]) {
      expect(filterJob({ title: "Backend Engineer", location })).toEqual({ pass: true });
    }
  });

  it("drops a dev job that is only abroad", () => {
    expect(filterJob({ title: "Backend Engineer", location: "Berlin, Germany" })).toEqual({
      pass: false,
      reason: "location:abroad",
    });
  });

  it("checks the title first, so the reason stays the most useful one", () => {
    expect(filterJob({ title: "Senior Backend Engineer", location: "Berlin, Germany" })).toEqual({
      pass: false,
      reason: "title:senior",
    });
  });

  it("keeps a job with no location", () => {
    expect(filterJob({ title: "Backend Engineer", location: null })).toEqual({ pass: true });
  });

  it("ignores the language of the ad", () => {
    const danish = { title: "Backend Developer", location: "Fredericia, Denmark", description: "Vil du være med til at udvikle løsninger? Flydende dansk er et krav." };
    expect(filterJob(danish)).toEqual({ pass: true });
  });
});
