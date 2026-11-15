import { XMLParser, XMLValidator } from "fast-xml-parser";

export type TeamtailorRawLocation = {
  name?: string;
  address?: string;
  zip?: string;
  city?: string;
  country?: string;
};

export type TeamtailorRawItem = {
  title?: string;
  description?: string;
  pubDate?: string;
  link?: string;
  guid?: string;
  remoteStatus?: string;
  company_name?: string;
  locations?: { location?: TeamtailorRawLocation[] } | "";
  department?: string;
  role?: string;
};

const ALWAYS_ARRAY = new Set(["item", "location"]);

const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (tagName) => ALWAYS_ARRAY.has(tagName),
});

export function parseTeamtailorFeed(xml: string): TeamtailorRawItem[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const { msg, line } = validation.err;
    throw new Error(`Teamtailor feed is not valid XML (line ${line}): ${msg}`);
  }

  const doc = parser.parse(xml) as { rss?: { channel?: { item?: TeamtailorRawItem[] } | "" } };
  const channel = doc.rss?.channel;
  if (channel === undefined) {
    throw new Error("Teamtailor feed has no <rss><channel>; got a different document");
  }
  return channel === "" ? [] : (channel.item ?? []);
}
