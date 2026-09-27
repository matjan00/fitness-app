// Recipe categories and keyword rules (Polish + English) used to suggest them. Pure — tests/food-cats.test.js.
import { fold } from './food-parse.js';

// Each category: key, label, and a regex over folded text (lower-case, no diacritics).
export const CATEGORIES = {
  meal: {
    label: 'Meal',
    items: [
      { key: 'breakfast', label: 'Breakfast', re: /\b(sniadan\w*|breakfast|owsiank\w*|oatmeal|porridge|jajecznic\w*|omlet\w*|omelet\w*|scrambled|pancake\w*|nalesnik\w*|placuszk\w*|granol\w*|overnight oats|shakshuk\w*|szakszuk\w*|kanapk\w*|tost\w*|toast|jaglank\w*|muesli|musli|smoothie bowl)\b/ },
      { key: 'lunch', label: 'Lunch', re: /\b(obiad\w*|lunch\w*|zup\w*|soup|risotto|gulasz\w*|kotlet\w*|schabow\w*|pierogi|obiadow\w*|lunchbox|meal ?prep)\b/ },
      { key: 'dinner', label: 'Dinner', re: /\b(kolacj\w*|dinner|supper|na wieczor|wieczorn\w*)\b/ },
      { key: 'snack', label: 'Snack', re: /\b(przekask\w*|snack\w*|batonik\w*|bar(?:s)?|hummus|dip|chips\w*|chipsy|koktajl\w*|smoothie\w*|shake|przystawk\w*|appetizer\w*|finger food|kulki mocy|energy balls?)\b/ },
      { key: 'dessert', label: 'Dessert', re: /\b(deser\w*|dessert\w*|ciast\w*|cake|sernik\w*|cheesecake|brownie\w*|ciasteczk\w*|cookie\w*|muffin\w*|babeczk\w*|lody|ice cream|tiramisu|szarlotk\w*|budyn\w*|pudding|mus czekoladow\w*|tort|torcik\w*|sweet treat|czekoladow\w*|chocolate)\b/ },
    ],
  },
  technique: {
    label: 'Cooking',
    items: [
      { key: 'oven', label: 'Oven', re: /\b(piekarnik\w*|piecz\w*|upiecz\w*|zapiek\w*|zapieczon\w*|oven|bake[ds]?|baking|roast\w*|casserole|tray ?bake|gratin|w naczyniu zaroodpornym)\b/ },
      { key: 'pan', label: 'Pan / fried', re: /\b(patelni\w*|smaz\w*|usmaz\w*|podsmaz\w*|obsmaz\w*|pan|skillet|fry|fried|frying|saute\w*|stir[- ]?fry|wok)\b/ },
      { key: 'airfryer', label: 'Air fryer', re: /\b(air ?fryer\w*|airfryer\w*|frytkownic\w* beztluszczow\w*|frytkownic\w*)\b/ },
      { key: 'grill', label: 'Grill', re: /\b(grill\w*|grilow\w*|bbq|barbecue|z rusztu|ruszt\w*)\b/ },
      { key: 'boiled', label: 'Boiled / steamed', re: /\b(gotuj\w*|ugotuj\w*|gotowan\w*|zagotuj\w*|parze|na parze|boil\w*|steam\w*|poach\w*|blanch\w*)\b/ },
      { key: 'stew', label: 'Stew / slow cooker', re: /\b(dus\w*|gulasz\w*|potrawk\w*|wolnowar\w*|slow ?cooker|crock ?pot|stew\w*|braise\w*|chili con carne|curry)\b/ },
      { key: 'nocook', label: 'No-cook', re: /\b(bez gotowania|bez pieczenia|no[- ]cook|no[- ]bake|salatk\w*|salad\w*|surowk\w*|overnight oats|na zimno)\b/ },
      { key: 'onepot', label: 'One-pot', re: /\b(one[- ]pot|one[- ]pan|jednogarnkow\w*|z jednego garnka|w jednym garnku|z jednej patelni|sheet pan)\b/ },
      { key: 'microwave', label: 'Microwave', re: /\b(mikrofal\w*|microwave\w*|mug cake)\b/ },
    ],
  },
  main: {
    label: 'Main ingredient',
    items: [
      { key: 'chicken', label: 'Chicken', re: /\b(kurczak\w*|kurczecia|drob\w*|drobiow\w*|chicken|udk\w* z kurczaka|piers\w* z kurczaka|skrzydel\w*)\b/ },
      { key: 'turkey', label: 'Turkey', re: /\b(indyk\w*|indycz\w*|turkey)\b/ },
      { key: 'beef', label: 'Beef', re: /\b(wolow\w*|wolowin\w*|beef|stek\w*|steak|rostbef\w*|burger\w*|antrykot\w*|cielecin\w*|veal)\b/ },
      { key: 'pork', label: 'Pork', re: /\b(wieprzow\w*|schab\w*|karkow\w*|boczek\w*|boczk\w*|bekon\w*|pork|bacon|zeberk\w*|kielbas\w*|szynk\w*|ham|sausage|chorizo)\b/ },
      { key: 'fish', label: 'Fish', re: /\b(ryb\w*|losos\w*|dorsz\w*|tunczyk\w*|makrel\w*|sledz\w*|pstrag\w*|mintaj\w*|morszczuk\w*|tilapi\w*|karp\w*|fish|salmon|cod|tuna|mackerel|trout|herring|sardyn\w*|sardine\w*)\b/ },
      { key: 'seafood', label: 'Seafood', re: /\b(krewet\w*|owoce morza|kalmar\w*|malz\w*|shrimp|prawn\w*|seafood|squid|mussel\w*|scallop\w*|octopus|osmiornic\w*)\b/ },
      { key: 'eggs', label: 'Eggs', re: /\b(jaj\w*|jajecznic\w*|omlet\w*|egg\w*|omelet\w*|frittat\w*|shakshuk\w*|szakszuk\w*)\b/ },
      { key: 'vege', label: 'Tofu / vegetarian', re: /\b(tofu|tempeh|wege\w*|wegetarian\w*|vegan\w*|wegan\w*|vegetarian|veggie|falafel\w*|seitan)\b/ },
      { key: 'pasta', label: 'Pasta', re: /\b(makaron\w*|spaghetti|penne|pasta|lasagn\w*|tagliatelle|noodle\w*|kluski|gnocchi|fusilli|swiderk\w*|ramen|orzo)\b/ },
      { key: 'rice', label: 'Rice', re: /\b(ryz\w*|rice|risotto|sushi|basmati|jasmin\w*|paella)\b/ },
      { key: 'potatoes', label: 'Potatoes', re: /\b(ziemniak\w*|kartofl\w*|potato\w*|frytk\w*|fries|batat\w*|sweet potato\w*|puree ziemniaczan\w*|placki ziemniaczane)\b/ },
      { key: 'groats', label: 'Groats (kasza)', re: /\b(kasz\w*|kasza|bulgur|kuskus|couscous|pecak\w*|quinoa|komos\w*|jaglan\w*|gryczan\w*|groats|buckwheat|millet|barley)\b/ },
      { key: 'legumes', label: 'Legumes', re: /\b(ciecierzyc\w*|cieciork\w*|soczewic\w*|fasol\w*|groch\w*|chickpea\w*|lentil\w*|bean\w*|hummus|edamame)\b/ },
      { key: 'twarog', label: 'Twaróg / cottage', re: /\b(twarog\w*|twarozk\w*|serek wiejski|serka wiejskiego|serkiem wiejskim|cottage|ricott\w*|skyr|quark)\b/ },
      { key: 'oats', label: 'Oats', re: /\b(owsian\w*|platki owsiane|platkow owsianych|oat\w*|porridge)\b/ },
      { key: 'veggies', label: 'Vegetables', re: /\b(warzyw\w*|vegetable\w*|cukini\w*|brokul\w*|kalafior\w*|zucchini|broccoli|cauliflower|szpinak\w*|spinach|dyni\w*|pumpkin)\b/ },
    ],
  },
};

export function catLabel(dim, key) {
  return CATEGORIES[dim]?.items.find((i) => i.key === key)?.label || key;
}

// Suggest categories from a recipe draft { title, ingredients: [{name}|string], steps: [string] }.
// Main ingredients are looked for in the title and ingredient names; techniques in title + steps; meal type in title + text.
export function suggestCategories(r) {
  const title = fold(r.title || '');
  const ingText = fold((r.ingredients || []).map((i) => (typeof i === 'string' ? i : `${i.name || ''} ${i.food?.en || ''} ${i.food?.pl || ''}`)).join(' | '));
  const steps = fold((r.steps || []).join(' '));
  const extra = fold(r.text || '');
  const out = { meal: [], technique: [], main: [] };

  for (const it of CATEGORIES.meal.items) if (it.re.test(title) || it.re.test(extra)) out.meal.push(it.key);
  for (const it of CATEGORIES.technique.items) if (it.re.test(title) || it.re.test(steps)) out.technique.push(it.key);
  for (const it of CATEGORIES.main.items) if (it.re.test(title) || it.re.test(ingText)) out.main.push(it.key);

  // "Dinner" and "lunch" are interchangeable for most mains; default a savoury main dish to lunch.
  if (!out.meal.length) {
    const sweet = /\b(cukier|sugar|miod|honey|czekolad\w*|chocolate|kakao|cocoa|budyn|wanili\w*|vanilla)\b/.test(ingText);
    const protein = out.main.some((k) => ['chicken', 'turkey', 'beef', 'pork', 'fish', 'seafood'].includes(k));
    const savoury = out.main.some((k) => ['rice', 'pasta', 'potatoes', 'groats', 'legumes', 'vege', 'eggs'].includes(k));
    if (sweet && !protein && !savoury) out.meal.push('dessert');
    else if (protein || out.main.some((k) => ['pasta', 'rice', 'potatoes', 'groats', 'legumes'].includes(k))) out.meal.push('lunch');
  }
  // "Pan" is too eager when steps only mention "rozgrzej patelnię" together with the oven etc. Keep it; the user can edit.
  // Vegetables only when there is no other main ingredient.
  if (out.main.length > 1) out.main = out.main.filter((k) => k !== 'veggies');
  // Avoid "eggs" when eggs are only a binder in baking or breading
  if (out.main.includes('eggs') && out.main.length > 1 && !/\b(jaj|egg|omlet|jajecznic|frittat|shakshuk|szakszuk)/.test(title)) out.main = out.main.filter((k) => k !== 'eggs');
  if (out.main.includes('oats') && out.main.length > 1 && !/\b(owsian|oat|porridge)/.test(title)) out.main = out.main.filter((k) => k !== 'oats');
  return out;
}
