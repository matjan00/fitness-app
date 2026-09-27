// Rule-based recipe text parser (Polish + English). Pure functions, no DOM — tested in tests/food-parse.test.js.
//
//   splitRecipeText(text)   → { title, ingredients: [line], steps: [line], servings, links }
//   parseIngredient(line)   → { raw, qty, unit, name, note, grams?, size?, toTaste?, head? }
//   parseQty(str)           → number | null
//   parseServings(text)     → number | null
//   fold(str)               → lower-case, no diacritics (ł → l), single spaces

const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const FRAC_RE = '[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]';

export function fold(s) {
  return String(s ?? '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// Number words that can stand in for a quantity.
const WORD_NUM = {
  'pol': 0.5, 'polowa': 0.5, 'polowka': 0.5, 'polowke': 0.5, 'poltorej': 1.5, 'poltora': 1.5,
  'jeden': 1, 'jedna': 1, 'jedno': 1, 'jednej': 1, 'dwa': 2, 'dwie': 2, 'dwoch': 2, 'trzy': 3, 'cztery': 4, 'piec': 5, 'szesc': 6,
  'kilka': 3, 'pare': 2, 'half': 0.5, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'a': 1, 'an': 1,
  'a few': 3, 'couple': 2, 'a couple of': 2, 'a couple': 2,
};

const WORD_NUM_RE = Object.keys(WORD_NUM).sort((a, b) => b.length - a.length).join('|');


// A single number: "1", "1.5", "1,5", "1 1/2", "1/2", "½", "1½", "1 ½".
const NUM = `(?:\\d+\\s*${FRAC_RE}|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|${FRAC_RE})`;
const RANGE = `${NUM}(?:\\s*(?:-|–|—|do|to|or|lub|albo)\\s*${NUM})?`;

function num1(s) {
  s = s.trim();
  let m;
  if ((m = s.match(new RegExp(`^(\\d+)\\s*(${FRAC_RE})$`)))) return Number(m[1]) + FRACTIONS[m[2]];
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  if (FRACTIONS[s] != null) return FRACTIONS[s];
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return null;
}

export function parseQty(str) {
  if (str == null) return null;
  const s = String(str).trim();
  const w = fold(s);
  if (WORD_NUM[w] != null) return WORD_NUM[w];
  const m = s.match(new RegExp(`^(${NUM})(?:\\s*(?:-|–|—|do|to|or|lub|albo)\\s*(${NUM}))?$`));
  if (!m) return null;
  const a = num1(m[1]);
  const b = m[2] ? num1(m[2]) : null;
  if (a == null) return null;
  return b != null ? (a + b) / 2 : a;
}

// ---------- units ----------
// key → list of spellings (folded, without diacritics). Order matters only for display.
export const UNIT_WORDS = {
  kg: ['kg', 'kilogram', 'kilograma', 'kilogramy', 'kilogramow', 'kilograms', 'kilo', 'kilos'],
  dag: ['dag', 'dkg', 'deko', 'dekagram', 'dekagramy', 'dekagramow'],
  mg: ['mg'],
  g: ['g', 'gr', 'gram', 'grama', 'gramy', 'gramow', 'grams', 'gramm', 'grammes'],
  l: ['l', 'litr', 'litra', 'litry', 'litrow', 'liter', 'liters', 'litre', 'litres', 'ltr'],
  dl: ['dl'],
  ml: ['ml', 'mililitr', 'mililitrow', 'mililitry', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'cm3'],
  tbsp: ['lyzka', 'lyzki', 'lyzek', 'lyzke', 'lyzkami', 'lyz', 'lyzk', 'lyzka stolowa', 'lyzki stolowe', 'tbsp', 'tbs', 'tbl', 'tablespoon', 'tablespoons', 'el'],
  tsp: ['lyzeczka', 'lyzeczki', 'lyzeczek', 'lyzeczke', 'lyzeczkami', 'lyzecz', 'lyzeczka herbaciana', 'tsp', 'teaspoon', 'teaspoons', 'tl'],
  glass: ['szklanka', 'szklanki', 'szklanek', 'szklanke', 'szkl', 'kubek', 'kubki', 'kubka'],
  cup: ['cup', 'cups', 'c'],
  floz: ['fl oz', 'fl. oz', 'fluid ounce', 'fluid ounces'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  piece: ['szt', 'sztuka', 'sztuki', 'sztuk', 'sztuke', 'pc', 'pcs', 'piece', 'pieces', 'x', 'whole'],
  clove: ['zabek', 'zabki', 'zabkow', 'zabka', 'clove', 'cloves'],
  handful: ['garsc', 'garsci', 'garstka', 'garstki', 'garstke', 'handful', 'handfuls'],
  pinch: ['szczypta', 'szczypty', 'szczypt', 'szczypte', 'szczypta', 'pinch', 'pinches', 'dash', 'odrobina', 'odrobine', 'splash'],
  pack: ['opakowanie', 'opakowania', 'opakowan', 'opak', 'op', 'paczka', 'paczki', 'paczek', 'paczke', 'saszetka', 'saszetki', 'torebka', 'torebki', 'package', 'packages', 'pack', 'packs', 'packet', 'packets', 'pkg', 'sachet', 'bag'],
  can: ['puszka', 'puszki', 'puszek', 'puszke', 'can', 'cans', 'tin', 'tins'],
  jar: ['sloik', 'sloika', 'sloiki', 'sloikow', 'sloiczek', 'jar', 'jars'],
  slice: ['plaster', 'plastry', 'plastrow', 'plasterek', 'plasterki', 'plasterkow', 'kromka', 'kromki', 'kromek', 'slice', 'slices'],
  bunch: ['peczek', 'peczki', 'peczka', 'bunch', 'bunches'],
  head: ['glowka', 'glowki', 'glowke', 'glowa', 'head', 'heads'],
  sprig: ['galazka', 'galazki', 'galazek', 'sprig', 'sprigs'],
  leaf: ['lisc', 'liscie', 'listek', 'listki', 'listkow', 'lisci', 'leaf', 'leaves'],
  stalk: ['lodyga', 'lodygi', 'lodyzka', 'lodyzki', 'stalk', 'stalks', 'stick', 'sticks'],
  cube: ['kostka', 'kostki', 'kostek', 'kostke', 'cube', 'cubes'],
  bar: ['tabliczka', 'tabliczki', 'tabliczek', 'bar', 'bars'],
  scoop: ['miarka', 'miarki', 'scoop', 'scoops'],
  drop: ['kropla', 'krople', 'kropli', 'drop', 'drops'],
  bottle: ['butelka', 'butelki', 'bottle', 'bottles'],
};
export const UNIT_LABEL = {
  g: 'g', kg: 'kg', dag: 'dag', mg: 'mg', l: 'l', dl: 'dl', ml: 'ml', tbsp: 'tbsp', tsp: 'tsp', glass: 'glass', cup: 'cup', floz: 'fl oz',
  oz: 'oz', lb: 'lb', piece: 'pc', clove: 'clove', handful: 'handful', pinch: 'pinch', pack: 'pack', can: 'can', jar: 'jar',
  slice: 'slice', bunch: 'bunch', head: 'head', sprig: 'sprig', leaf: 'leaf', stalk: 'stalk', cube: 'cube', bar: 'bar', scoop: 'scoop',
  drop: 'drop', bottle: 'bottle',
};
const UNIT_LOOKUP = new Map();
for (const [key, words] of Object.entries(UNIT_WORDS)) for (const w of words) if (!UNIT_LOOKUP.has(w)) UNIT_LOOKUP.set(w, key);
// Spellings sorted longest first so "lyzeczka" wins over "lyz".
const UNIT_ALTS = [...UNIT_LOOKUP.keys()].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.]/g, '\\.').replace(/ /g, '\\s+'));
const UNIT_RE = `(?:${UNIT_ALTS.join('|')})`;
// Units that are only accepted when directly after a number ("2 x", "3 c"): too ambiguous otherwise.
const WEAK_UNITS = new Set(['x', 'c', 'op', 'el', 'tl', 'a']);

const SIZE_WORDS = {
  large: ['duzy', 'duza', 'duze', 'duzych', 'duzej', 'duzego', 'large', 'big', 'wielki', 'wielka'],
  medium: ['sredni', 'srednia', 'srednie', 'srednich', 'sredniej', 'sredniego', 'medium'],
  small: ['maly', 'mala', 'male', 'malych', 'malej', 'malego', 'small', 'niewielki', 'niewielka', 'niewielkie'],
};
const SIZE_LOOKUP = new Map(Object.entries(SIZE_WORDS).flatMap(([k, ws]) => ws.map((w) => [w, k])));

// Sub-headings inside ingredient lists ("Ciasto", "Na sos", "For the dressing")
const HEAD_WORDS = /^(?:(?:na|do|for the|for)\s+)?(?:ciasto|nadzienie|farsz|dodatki|sos|marynata|marynaty|krem|polewa|polewe|posypka|kruszonka|masa|dressing|topping|toppings|glaze|frosting|filling|sauce|marinade|dough|batter|crust|garnish|do podania|to serve|spod|spodu|wierzch|salsa)$/;
const TO_TASTE =/\b(do smaku|wedlug uznania|wg uznania|opcjonalnie|optional|to taste|as needed|for serving|do podania|do posypania|do dekoracji|for garnish|to garnish|na oko|as desired)\b/;
const APPROX_CORE = '(?:ok\\.?|okolo|about|approx\\.?|approximately|circa|ca\\.|~)';
const APPROX = new RegExp(`^${APPROX_CORE}\\s*`, 'i');

function stripBullet(line) {
  let s = String(line ?? '');
  // emoji / pictographs / bullets / dashes at the start
  s = s.replace(/^[\s\u2022\u2023\u25aa\u25ab\u25cf\u25cb\u25e6\u2043\u2219\u00b7*•▪►▶➤➡✔✅☑✓✨⭐️🔸🔹🔶🔷▫️◾◽\-–—+>·]+/u, '');
  s = s.replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\ufe0e|\s)+/u, '');
  // "1." / "2)" numbered list markers — only when followed by space and not a unit/quantity context like "1.5"
  s = s.replace(/^\(?\d{1,2}[.)]\s+(?=\D)/, '');
  return s.trim();
}

function cleanName(s) {
  return s.replace(/\s+/g, ' ').replace(/^[\s,:;.\-–—]+|[\s,:;.\-–—]+$/g, '').trim();
}

// Parse one ingredient line.
export function parseIngredient(line) {
  const raw = String(line ?? '').trim();
  let s = stripBullet(raw).replace(/\s+/g, ' ');
  const out = { raw, qty: null, unit: null, name: '', note: '' };
  if (!s) return out;

  // Section heading inside ingredient lists: "Sos:", "Na ciasto:", "For the sauce:"
  if (/:$/.test(s) && s.length < 40 && !/\d/.test(s)) { out.head = true; out.name = s.replace(/:$/, ''); return out; }
  if (HEAD_WORDS.test(fold(s))) { out.head = true; out.name = s; return out; }

  const notes = [];
  // Parenthesised parts become notes; if they carry a weight ("ok. 200 g") remember it.
  s = s.replace(/\(([^()]*)\)/g, (_, inner) => {
    const w = weightIn(inner);
    if (w != null && out.grams == null) out.grams = w;
    else if (inner.trim()) notes.push(inner.trim());
    return ' ';
  }).replace(/\s+/g, ' ').trim();

  // A total weight at the end: "6 pomidorów - 850 g", "3 szklanki mąki -400 g", "papryki: 2 żółte… = 850 g"
  {
    const m = s.match(/^(.*\S)\s*[-–—=]\s*((?:ok\.?\s*|około\s*|~\s*)?\d+(?:[.,]\d+)?\s*(?:g|kg|dag|ml|l)\.?)$/i);
    const leadsWithQty = /^(\d|[½⅓⅔¼¾]|pół|półtor)/i.test(s);
    if (m && (leadsWithQty || /:/.test(m[1]))) {
      const w = weightIn(m[2]);
      if (w != null) { out.grams = w; s = m[1].trim(); }
    }
    // "papryki: 2 żółte, 2 czerwone" → name "papryki", the rest is a note
    const c = s.match(/^([^\d:]{2,40}):\s*(.+)$/);
    if (c && out.grams != null) { notes.push(c[2]); s = c[1]; }
  }
  // "2 płaskie łyżeczki", "1 heaped tbsp" → drop the spoon modifier
  s = s.replace(/^(\S+\s+)(?:płask\p{L}*|czubat\p{L}*|pełn\p{L}*|niepełn\p{L}*|level|heaped|heaping|rounded|scant)\s+/iu, '$1');
  // "4 średnie ząbki czosnku", "2 large cloves garlic": the size sits between the number and the unit
  s = s.replace(/^(\S+\s+)(\p{L}+)\s+(?=\p{L})/u, (m, a, word) => {
    const size = SIZE_LOOKUP.get(fold(word));
    if (!size) return m;
    const rest = fold(s.slice(m.length)).split(' ')[0];
    if (!UNIT_LOOKUP.has(rest) || WEAK_UNITS.has(rest)) return m;
    out.size = size;
    return a;
  });
  s = s.replace(/^(?:płask\p{L}*|czubat\p{L}*)\s+/iu, '');
  // "2 i 1/2 szklanki" / "1 and 1/2 cups" → "2 1/2"
  s = s.replace(/^(\d+)\s+(?:i|and|&)\s+(\d+\/\d+|[½⅓⅔¼¾])/, '$1 $2');
  // '2 x 100 g jogurtu' → 200 g
  s = s.replace(/^(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?=\s*[a-zA-Ząćęłńóśźż])/,(_, a, b) => String(Number(a) * Number(b.replace(',', '.'))));
  let f = fold(s);
  if (TO_TASTE.test(f)) { out.toTaste = true; }

  // Leading quantity + unit: "200 g mąki", "2 łyżki oliwy", "1½ cup flour", "2x jajko", "pół szklanki mleka"
  const lead = new RegExp(`^(${APPROX_CORE}\\s*)?(${RANGE}(?=\\s|$|[a-z])|(?:${WORD_NUM_RE})(?=\\s|$))\\s*(?:x\\s*)?(${UNIT_RE})?(?=\\s|$|[.,:;)])\\.?\\s*(?:of\\s+)?(.*)$`, 'i');
  let m = f.match(lead);
  let restFolded = null;
  if (m) {
    const qty = parseQty(m[2].replace(/\s+/g, ' '));
    const unitWord = m[3] ? m[3].replace(/\s+/g, ' ') : null;
    // "a" / "an" only counts as a quantity when followed by a unit ("a pinch of salt").
    if (/^an?$/.test(m[2]) && !unitWord) m = null;
    else {
      out.qty = qty;
      if (unitWord) out.unit = UNIT_LOOKUP.get(unitWord) || null;
      restFolded = m[4];
    }
  }
  if (m) {
    // keep the original casing/diacritics of the name: take the same number of trailing characters
    s = s.slice(s.length - restFolded.length);
  } else {
    // Trailing quantity: "mąka pszenna – 500 g", "Cukier: 2 łyżki", "sól 1 łyżeczka", "jajka 3 szt."
    const tail = new RegExp(`^(.*?)[\\s:–—-]+(?:${APPROX_CORE}\\s*)?(${RANGE}|pol|poltorej)\\s*(${UNIT_RE})?\\.?(?:\\s+(.*))?$`, 'i');
    const t = f.match(tail);
    if (t && t[1] && !/\d$/.test(t[1]) && (t[3] || !t[4])) {
      out.qty = parseQty(t[2]);
      if (t[3]) out.unit = UNIT_LOOKUP.get(t[3].replace(/\s+/g, ' ')) || null;
      const nameLen = t[1].length;
      if (t[4]) notes.push(s.slice(s.length - t[4].length));
      s = s.slice(0, nameLen);
    }
  }
  // Unit without a number: "szczypta soli", "pinch of salt", "garść rukoli", "ząbek czosnku"
  if (out.qty == null) {
    f = fold(s);
    const u = f.match(new RegExp(`^(${UNIT_RE})\\.?\\s+(?:of\\s+)?(.+)$`));
    if (u && !WEAK_UNITS.has(u[1]) && UNIT_LOOKUP.get(u[1].replace(/\s+/g, ' '))) {
      out.unit = UNIT_LOOKUP.get(u[1].replace(/\s+/g, ' '));
      out.qty = 1;
      s = s.slice(s.length - u[2].length);
    }
  }

  // Size adjective: "1 duża cebula", "2 medium onions"
  f = fold(s);
  const firstWord = f.split(' ')[0];
  if (SIZE_LOOKUP.has(firstWord)) {
    out.size = SIZE_LOOKUP.get(firstWord);
    s = s.slice(s.indexOf(' ') + 1 || s.length);
  }

  // Notes after a comma / dash: "cebula, posiekana", "czosnek – przeciśnięty"
  const cut = s.search(/\s*((?<!\d),|,(?!\d)|;|\s[–—-]\s)\s*/);
  if (cut > 0) {
    const rest = s.slice(cut).replace(/^\s*(,|;|[–—-])\s*/, '');
    // "sól, pieprz" stays one name (both are ingredients); only split when the rest looks like a preparation note.
    if (!/^(sol|pieprz|salt|pepper)\b/.test(fold(rest))) {
      notes.unshift(rest);
      s = s.slice(0, cut);
    }
  }
  // Trailing "do smaku"/"to taste" as note
  s = s.replace(/\s+(do smaku|według uznania|wg uznania|opcjonalnie|optional|to taste|as needed|do podania|for serving|do posypania)$/i, (x) => { notes.push(x.trim()); return ''; });
  s = s.replace(APPROX, '');

  out.name = cleanName(s);
  out.note = notes.map((n) => n.trim()).filter(Boolean).join(', ');
  if (!out.name && out.note) { out.name = out.note; out.note = ''; }
  return out;
}

// "ok. 200 g" / "150g" / "about 1 lb" → grams, else null
function weightIn(text) {
  const f = fold(text).replace(APPROX, '');
  const m = f.match(new RegExp(`^(?:${APPROX_CORE}\\s*)?(${RANGE})\\s*(g|gr|gram|gramow|grams|kg|dag|dkg|ml|l|oz|lb)\\.?\\b`));
  if (!m) return null;
  const q = parseQty(m[1]);
  if (q == null) return null;
  const k = { g: 1, gr: 1, gram: 1, gramow: 1, grams: 1, kg: 1000, dag: 10, dkg: 10, ml: 1, l: 1000, oz: 28.35, lb: 453.6 }[m[2]];
  return Math.round(q * k * 10) / 10;
}

// ---------- servings ----------
export function parseServings(text) {
  const f = fold(text);
  const pats = [
    /\bna\s+(\d+)(?:\s*-\s*\d+)?\s*(?:porcj|osob|os\.|talerz|sztuk|szt)/,
    /\bdla\s+(\d+)(?:\s*-\s*\d+)?\s*(?:osob|os\.)/,
    /\b(\d+)(?:\s*-\s*\d+)?\s*(?:porcj[aei]?|porcji|osob|servings?|portions?)\b/,
    /\b(?:porcje|porcji|ilosc porcji|liczba porcji|servings|serves|yield|makes|portions)\s*[:\-]?\s*(\d+)/,
    /\bserves\s+(\d+)/,
  ];
  for (const re of pats) {
    const m = f.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n > 0 && n <= 50) return n;
    }
  }
  return null;
}

// ---------- splitting a caption / description into parts ----------
const ING_HEAD = /^(?:skladniki|skladnik|lista skladnikow|potrzebne skladniki|potrzebujesz|bedziesz potrzebowac|co potrzebujesz|co potrzebujemy|zakupy|lista zakupow|ingredients?|you(?:'| wi)ll need|what you need|shopping list)\b[^a-z0-9]*(.*)$/;
const STEP_HEAD = /^(?:przygotowanie|sposob przygotowania|sposob wykonania|wykonanie|instrukcja|instrukcje|jak zrobic|jak przygotowac|krok po kroku|kroki|instructions?|method|directions?|steps?|preparation)\b[^a-z0-9]*(.*)$/;
const END_HEAD = /^(?:uwagi|wskazowki|porady|tipy?|notes?|tips?|smacznego|enjoy|wartosci odzywcze|makro|makroskladniki|nutrition|kalorie|kcal|propozycja podania|komentarze|podobne przepisy|zobacz tez|zobacz rowniez|related|you may also like|comments|reviews|opinie)\b/;
// A line that is only a yield: "16 - 17 sztuk", "4 porcje", "Serves 4"
const YIELD_LINE = /^(?:(?:na\s+)?\d+(?:\s*-\s*\d+)?\s*(?:szt\.?|sztuk[ia]?|porcj[aei]?|porcji|osob[ya]?|servings?|portions?|pieces?)|serves\s+\d+|porcje:?\s*\d+)$/;
const QTY_START = new RegExp(`^(?:${RANGE}|pol |poltorej |szczypta|garsc|zabek|kilka|pare|a pinch|a handful|one |two |three |half )`);
const QTY_ANY = new RegExp(`(?:^|\\s)${NUM}\\s*(?:${UNIT_RE})(?=\\s|$|[.,;:)])`);
const COOK_VERB = /\b(dodaj|dodac|wymieszaj|wymieszac|smaz|smazyc|piecz|piec|gotuj|gotowac|pokroj|pokroic|wlej|wlac|podsmaz|dus|dusic|zagotuj|odcedz|przelozyc|przeloz|posyp|podawaj|podac|rozgrzej|nagrzej|wstaw|wyjmij|zblenduj|zmiksuj|ubij|obierz|posiekaj|marynuj|dopraw|doprawic|mix|add|stir|bake|cook|fry|boil|simmer|chop|slice|heat|preheat|serve|pour|whisk|season|combine|place|remove|blend|roast|grill|let|set aside|transfer|spread|sprinkle|drain)\b/;

const HASHTAG = /(^|\s)[#＃][\p{L}\p{N}_]+/gu;
const MENTION = /(^|\s)@[\w.]+/g;

export function extractLinks(text) {
  return [...String(text ?? '').matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));
}

function cleanLine(l) {
  return l.replace(HASHTAG, '$1').replace(MENTION, '$1').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
}

function looksLikeIngredient(line) {
  const f = fold(stripBullet(line));
  if (!f) return false;
  if (f.length > 90 || isMacroLine(f)) return false;
  if (QTY_START.test(f) || QTY_ANY.test(f)) return !(COOK_VERB.test(f) && f.split(' ').length > 8);
  return false;
}
// "520 kcal | 45 g białka" — nutrition summary, not an ingredient
function isMacroLine(f) {
  return /\b(kcal|kalori\w*|calories|cals?)\b/.test(f) || (f.match(/\b(bialk\w*|protein|wegl\w*|carbs?|tluszcz\w*|fat)\b/g) || []).length >= 2;
}
// A short line without a quantity that is still an ingredient: "Sól i pieprz do smaku", "Natka pietruszki"
function looksLikeBareIngredient(line) {
  const f = fold(stripBullet(line));
  if (!f || isMacroLine(f) || /[.!?]$/.test(f)) return false;
  if (TO_TASTE.test(f)) return f.split(' ').length <= 7;
  return f.split(' ').length <= 4 && !COOK_VERB.test(f);
}
function looksLikeStep(line) {
  const f = fold(stripBullet(line));
  return f.split(' ').length >= 5 && (COOK_VERB.test(f) || /[.!]$/.test(f));
}

// Split one long line like "Składniki: 200 g makaronu, 1 cebula, 2 ząbki czosnku" into items.
function splitInlineList(text) {
  const parts = text.split(/\s*(?:,|;|\s\|\s|•|·)\s*(?![^(]*\))/).map((p) => p.trim()).filter(Boolean);
  // re-join fragments that are just notes ("posiekana") onto the previous ingredient
  const out = [];
  for (const p of parts) {
    if (out.length && !QTY_START.test(fold(p)) && !QTY_ANY.test(fold(p)) && p.split(' ').length <= 2 && /^(posiekan|pokrojon|drobno|starta|start|obran|ugotowan|chopped|diced|minced|sliced|peeled|grated)/.test(fold(p))) {
      out[out.length - 1] += `, ${p}`;
    } else out.push(p);
  }
  return out;
}

// Break a paragraph of steps into sentences / numbered steps.
function splitSteps(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  // numbered: "1. ... 2. ..." or "1) ... 2) ..." or "Krok 1: ..."
  const numbered = t.split(/\s*(?:^|\s)(?:krok\s*)?\d{1,2}[.):]\s+(?=\p{Lu}|\p{Ll})/iu).map((s) => s.trim()).filter(Boolean);
  if (numbered.length >= 2) return numbered;
  const sentences = t.split(/(?<=[.!?])\s+(?=\p{Lu})/u).map((s) => s.trim()).filter(Boolean);
  return sentences;
}

export function splitRecipeText(input) {
  let text = String(input ?? '').replace(/\r/g, '').replace(/\u00a0/g, ' ');
  // Captions from TikTok arrive on one line: the line breaks became double spaces, bullets are " * ".
  if ((text.match(/\n/g) || []).length < 3) {
    text = text.replace(/ {2,}/g, '\n').replace(/\s+[*\u2022\u25aa]\s+/g, '\n* ').replace(/\s+(?=(?:\p{Extended_Pictographic}\ufe0f?)+\s*\d)/gu, '\n')
      .replace(/\s+(?=\p{Lu}\p{Ll}{2,}:(?:\s|$))/gu, '\n');
    // Re-join a sentence that was broken by a stray double space: "Po doprowadzeniu ry\u017cu" + "do wrzenia, \u2026"
    const ls = text.split('\n');
    for (let i = ls.length - 2; i >= 0; i--) {
      if (/^\p{Ll}/u.test(ls[i + 1].trim()) && ls[i].trim() && !/[.!?:]$/.test(ls[i].trim()) && !looksLikeIngredient(ls[i])) {
        ls[i] = `${ls[i].trim()} ${ls[i + 1].trim()}`;
        ls.splice(i + 1, 1);
      }
    }
    text = ls.join('\n');
  }
  const links = extractLinks(text);
  let servings = parseServings(text);
  let lines = text.split('\n').map((l) => l.trim());

  // Inline section headers inside one line: "…text. Składniki: a, b, c. Przygotowanie: …" → split into lines
  lines = lines.flatMap((l) => {
    const f = fold(l);
    const parts = [];
    let last = 0;
    const re = /(skladniki|ingredients|przygotowanie|sposob przygotowania|wykonanie|instructions|method|directions)\s*:/g;
    let m;
    while ((m = re.exec(f))) {
      if (m.index > 0) { parts.push(l.slice(last, m.index).trim()); last = m.index; }
    }
    parts.push(l.slice(last).trim());
    return parts.filter((p, i) => p || i === 0);
  });

  let title = '';
  const ingredients = [];
  const steps = [];
  const other = [];
  let mode = 'intro';
  let sawHeader = false;

  for (let rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    const f = fold(stripBullet(line)).replace(/[:!]+$/, '');
    let m;
    if ((m = fold(stripBullet(line)).match(ING_HEAD)) && (f.length < 40 || /:/.test(line))) {
      // Anything that only looked like an ingredient before the real "Składniki:" header was intro text.
      if (!sawHeader && (ingredients.length || steps.length)) { other.push(...ingredients, ...steps); ingredients.length = 0; steps.length = 0; }
      mode = 'ing'; sawHeader = true;
      const rest = stripBullet(line).replace(/^[^:]*:\s*/, '');
      if (m[1] && rest && rest !== stripBullet(line)) splitInlineList(rest).forEach((x) => ingredients.push(x));
      continue;
    }
    if ((m = fold(stripBullet(line)).match(STEP_HEAD)) && (f.length < 40 || /:/.test(line))) {
      mode = 'steps'; sawHeader = true;
      const rest = stripBullet(line).replace(/^[^:]*:\s*/, '');
      if (m[1] && rest && rest !== stripBullet(line)) splitSteps(rest).forEach((x) => steps.push(x));
      continue;
    }
    if (END_HEAD.test(f) && f.length < 40) {
      if (mode === 'ing' || mode === 'steps') mode = 'end';
      continue;
    }

    if (isMacroLine(f) && f.length < 80 && (title || /^\W*\d/.test(f))) { other.push(stripBullet(line)); continue; }
    if (YIELD_LINE.test(f)) {
      other.push(stripBullet(line));
      const n = Number((f.match(/\d+/) || [])[0]);
      if (servings == null && n > 0 && n <= 50) servings = n;
      continue;
    }
    if (mode === 'ing') {
      // A long prose line after ingredients without a header is probably the method.
      if (!looksLikeIngredient(line) && looksLikeStep(line) && line.length > 60) {
        mode = 'steps';
        splitSteps(stripBullet(line)).forEach((x) => steps.push(x));
        continue;
      }
      const items = splitItems(line);
      items.forEach((x) => ingredients.push(x));
    } else if (mode === 'steps') {
      const s = stripBullet(line);
      if (/^\d{1,2}[.)]\s/.test(line.trim()) || s.length < 200) steps.push(s);
      else splitSteps(s).forEach((x) => steps.push(x));
    } else if (mode === 'intro') {
      if (!title && !looksLikeIngredient(line)) { title = stripBullet(line); continue; }
      if (parseIngredient(line).head && line.length < 30) { ingredients.push(stripBullet(line)); continue; }
      if (looksLikeIngredient(line) || (ingredients.length && !steps.length && looksLikeBareIngredient(line))) {
        const items = splitItems(line);
        items.forEach((x) => ingredients.push(x));
      } else if (!sawHeader && ingredients.length && looksLikeStep(line)) {
        splitSteps(stripBullet(line)).forEach((x) => steps.push(x));
      } else other.push(stripBullet(line));
    }
  }

  // No explicit ingredient lines at all: try to find an inline list anywhere in the text
  if (!ingredients.length) {
    for (const o of [title, ...other]) {
      if ((o.match(QTY_ANY_G) || []).length >= 2) {
        splitInlineList(o).filter((x) => looksLikeIngredient(x)).forEach((x) => ingredients.push(x));
      }
    }
  }

  title = shortTitle(title);
  return { title, ingredients: ingredients.map((x) => x.trim().replace(/[.;]+$/, '')).filter(Boolean), steps: steps.filter((s) => s.length > 1), servings, links, intro: other };
}

const QTY_ANY_G = new RegExp(`(?:^|\\s)${NUM}\\s*(?:${UNIT_RE})(?=\\s|$|[.,;:)])`, 'g');

// Captions often start with a long sentence; keep the first sentence / up to ~80 characters as the title.
export function shortTitle(t) {
  // Emoji in the middle of a caption usually separate the title from the rest: "Makaron \ud83c\udf5d\ud83d\udd25 Idealny obiad\u2026"
  let s = String(t ?? '').replace(HASHTAG, '$1').trim()
    .replace(/^(?:\p{Extended_Pictographic}|\ufe0f|\u200d|\s)+/u, '')
    .replace(/(?:\s*(?:\p{Extended_Pictographic}|\ufe0f|\u200d)+\s*)+/gu, ' | ')
    .replace(/\s+/g, ' ').replace(/[\s|]+$/, '').trim();
  s = s.replace(/^(przepis na|recipe for|recipe:|przepis:)\s*/i, (x) => (x.toLowerCase().startsWith('przepis na') ? '' : ''));
  const first = s.split(/(?<=[.!?])\s|\s[|–—]\s/)[0];
  s = first.length >= 3 ? first : s;
  s = s.replace(/[.!:;,]+$/, '').trim();
  // "PROSTY KURCZAK Z MAKARONEM" → "Prosty kurczak z makaronem"
  if (/\p{Lu}{3}/u.test(s) && s === s.toUpperCase()) s = s.toLowerCase();
  if (s.length > 80) s = `${s.slice(0, 77).replace(/\s+\S*$/, '')}…`;
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

// ISO-8601 duration ("PT1H20M") or plain minutes → minutes
export function durationMin(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const m = String(v).match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (m) return (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) + Math.round(Number(m[4] || 0) / 60) || null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// One line can hold several ingredients: "200 g mąki, 2 jajka" or "250 g ryżu 300 ml wody".
function splitItems(line) {
  const s = stripBullet(line);
  const f = fold(s);
  const re = new RegExp(`(?:^|\\s)(${NUM}\\s*(?:${UNIT_RE}))(?=\\s|$|[.,;:)])`, 'g');
  const hits = [...f.matchAll(re)];
  if (hits.length < 2) return [s];
  if (/[,;]/.test(s)) return splitInlineList(s);
  const starts = hits.map((m) => m.index + (m[0].length - m[1].length));
  if (starts[0] !== 0) return [s];
  const out = [];
  for (let i = 0; i < starts.length; i++) out.push(s.slice(starts[i], starts[i + 1] ?? s.length).trim());
  return out.filter(Boolean);
}
