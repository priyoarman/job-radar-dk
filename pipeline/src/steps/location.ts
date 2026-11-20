export type PlaceKind = "denmark" | "region" | "abroad" | "unknown";

const DENMARK = [
  "denmark", "danmark", "dk", "københavn", "kobenhavn", "copenhagen", "cph", "frederiksberg", "aarhus", "århus",
  "odense", "aalborg", "esbjerg", "randers", "kolding", "horsens", "vejle", "roskilde", "herning", "silkeborg",
  "næstved", "fredericia", "viborg", "køge", "holstebro", "taastrup", "slagelse", "hillerød", "sønderborg",
  "svendborg", "herlev", "ballerup", "lyngby", "kgs. lyngby", "gentofte", "hellerup", "søborg", "glostrup",
  "albertslund", "brøndby", "hvidovre", "valby", "ørestad", "nordhavn", "kastrup", "billund", "skanderborg",
  "hørsholm", "birkerød", "allerød", "bagsværd", "måløv", "højbjerg", "risskov", "nørresundby", "greve", "ishøj",
];

const REGION = [
  "remote", "anywhere", "worldwide", "global", "europe", "european", "eu", "emea", "nordic", "nordics",
  "scandinavia", "cet",
];

const ABROAD = [
  "udlandet", "sweden", "sverige", "norway", "norge", "finland", "iceland", "germany", "deutschland", "netherlands",
  "holland", "belgium", "france", "spain", "portugal", "italy", "poland", "lithuania", "latvia", "estonia",
  "ireland", "united kingdom", "england", "scotland", "wales", "northern ireland", "united states", "canada",
  "india", "romania", "ukraine", "czech republic", "czechia", "austria", "switzerland", "hungary", "greece",
  "bulgaria", "croatia", "serbia", "slovakia", "slovenia", "turkey", "turkiye", "türkiye", "israel", "singapore",
  "australia", "brazil", "mexico", "japan", "china", "philippines", "south africa", "egypt",
  "united arab emirates", "uae", "dubai", "stockholm", "gothenburg", "göteborg", "malmö", "malmo", "uppsala",
  "oslo", "bergen", "helsinki", "berlin", "munich", "münchen", "hamburg", "frankfurt", "cologne", "köln",
  "amsterdam", "rotterdam", "eindhoven", "utrecht", "the hague", "brussels", "antwerp", "london", "manchester",
  "edinburgh", "dublin", "paris", "lyon", "madrid", "barcelona", "lisbon", "porto", "milan", "rome", "warsaw",
  "krakow", "kraków", "wroclaw", "wrocław", "vilnius", "riga", "tallinn", "prague", "vienna", "zurich", "zürich",
  "geneva", "budapest", "bucharest", "cluj", "kyiv", "new york", "san francisco", "boston", "seattle",
  "austin", "toronto", "bangalore", "bengaluru", "pune", "hyderabad", "hong kong", "macau", "korea", "bosnia",
  "macedonia", "burma", "ivory coast", "palestine", "swaziland",
];

const ABROAD_UPPERCASE = ["UK", "US", "USA"];

const NOT_A_COUNTRY = new Set(["DK", "EU", "EZ", "UN", "QO", "ZZ"]);

function countryNames(): string[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const result: string[] = [];
  for (const a of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    for (const b of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const code = `${a}${b}`;
      if (NOT_A_COUNTRY.has(code)) continue;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        continue;
      }
      if (name && name !== code) result.push(name.replace(/\s*\(.*\)$/, "").replace(/ SAR China$/, "").toLowerCase());
    }
  }
  return result;
}

const US_STATES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
  "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma",
  "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah",
  "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming", "washington d.c.", "d.c.",
];

const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];

const OTHER_REGIONS = [
  "ontario", "quebec", "québec", "british columbia", "alberta", "new south wales", "queensland", "victoria, australia",
  "bavaria", "bayern", "england", "scotland", "wales",
  "apac", "asia pacific", "asia", "namer", "amer", "americas", "north america", "south america", "latin america",
  "latam", "central america", "middle east", "mena", "africa", "oceania", "anz",
];

const WORLD_CITIES = [
  "melbourne", "sydney", "brisbane", "perth", "auckland", "chicago", "los angeles", "denver", "atlanta", "dallas",
  "houston", "miami", "philadelphia", "phoenix", "portland", "salt lake city", "minneapolis", "detroit", "pittsburgh",
  "raleigh", "nashville", "san diego", "san jose", "sunnyvale", "mountain view", "palo alto", "menlo park",
  "grand rapids", "montreal", "montréal", "vancouver", "calgary", "ottawa", "mexico city", "são paulo", "sao paulo",
  "rio de janeiro", "buenos aires", "bogotá", "bogota", "santiago", "lima", "tokyo", "osaka", "seoul", "shanghai",
  "beijing", "shenzhen", "taipei", "manila", "jakarta", "kuala lumpur", "bangkok", "ho chi minh city", "hanoi",
  "mumbai", "delhi", "new delhi", "gurgaon", "gurugram", "noida", "chennai", "kolkata", "tel aviv", "istanbul",
  "cairo", "lagos", "nairobi", "cape town", "johannesburg", "abu dhabi", "doha", "riyadh",
];

const ABROAD_ALL = [...new Set([...ABROAD, ...countryNames(), ...US_STATES, ...OTHER_REGIONS, ...WORLD_CITIES])];

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{N}])";

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordList = (words: string[], flags: string) =>
  new RegExp(`${NOT_LETTER_BEFORE}(${words.map(escape).join("|")})${NOT_LETTER_AFTER}`, flags);

const DENMARK_REGEX = wordList(DENMARK, "iu");
const REGION_REGEX = wordList(REGION, "iu");
const ABROAD_REGEX = wordList(ABROAD_ALL, "iu");
const ABROAD_UPPERCASE_REGEX = wordList(ABROAD_UPPERCASE, "u");
const US_STATE_CODE_REGEX = new RegExp(`,\\s*(${US_STATE_CODES.join("|")})${NOT_LETTER_AFTER}`, "u");
const US_PREFIXED_CODE_REGEX = /(?<![\p{L}\p{N}])US-?[A-Z]{2}(?![\p{L}\p{N}])/u;

export function classifyPlace(place: string): PlaceKind {
  if (DENMARK_REGEX.test(place)) return "denmark";
  if (
    ABROAD_REGEX.test(place) ||
    ABROAD_UPPERCASE_REGEX.test(place) ||
    US_STATE_CODE_REGEX.test(place) ||
    US_PREFIXED_CODE_REGEX.test(place)
  ) {
    return "abroad";
  }
  if (REGION_REGEX.test(place)) return "region";
  return "unknown";
}

export function isAbroadOnly(location: string | null): boolean {
  if (location === null) return false;
  const places = location
    .split(/[;|/]/)
    .map((place) => place.trim())
    .filter(Boolean);
  return places.length > 0 && places.every((place) => classifyPlace(place) === "abroad");
}
