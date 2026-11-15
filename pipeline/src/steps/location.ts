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
  "sweden", "sverige", "norway", "norge", "finland", "iceland", "germany", "deutschland", "netherlands",
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
  "austin", "toronto", "bangalore", "bengaluru", "pune", "hyderabad",
];

const ABROAD_UPPERCASE = ["UK", "US", "USA"];

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{N}])";

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordList = (words: string[], flags: string) =>
  new RegExp(`${NOT_LETTER_BEFORE}(${words.map(escape).join("|")})${NOT_LETTER_AFTER}`, flags);

const DENMARK_REGEX = wordList(DENMARK, "iu");
const REGION_REGEX = wordList(REGION, "iu");
const ABROAD_REGEX = wordList(ABROAD, "iu");
const ABROAD_UPPERCASE_REGEX = wordList(ABROAD_UPPERCASE, "u");

export function classifyPlace(place: string): PlaceKind {
  if (DENMARK_REGEX.test(place)) return "denmark";
  if (ABROAD_REGEX.test(place) || ABROAD_UPPERCASE_REGEX.test(place)) return "abroad";
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
