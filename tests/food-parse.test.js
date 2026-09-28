import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredient, parseQty, parseServings, splitRecipeText, fold, shortTitle, durationMin } from '../docs/food-parse.js';

const P = (line) => {
  const r = parseIngredient(line);
  return { qty: r.qty, unit: r.unit, name: r.name, ...(r.grams != null ? { grams: r.grams } : {}), ...(r.size ? { size: r.size } : {}) };
};

test('fold strips Polish diacritics', () => {
  assert.equal(fold('Źdźbło ŁÓDŹ Mąka'), 'zdzblo lodz maka');
});

test('parseQty handles fractions, commas, ranges and words', () => {
  assert.equal(parseQty('1,5'), 1.5);
  assert.equal(parseQty('1.5'), 1.5);
  assert.equal(parseQty('½'), 0.5);
  assert.equal(parseQty('1½'), 1.5);
  assert.equal(parseQty('1 1/2'), 1.5);
  assert.equal(parseQty('3/4'), 0.75);
  assert.equal(parseQty('2-3'), 2.5);
  assert.equal(parseQty('2–4'), 3);
  assert.equal(parseQty('pół'), 0.5);
  assert.equal(parseQty('półtorej'), 1.5);
  assert.equal(parseQty('dwie'), 2);
  assert.equal(parseQty('abc'), null);
});

test('Polish ingredient lines', () => {
  const cases = [
    ['200 g mąki pszennej', { qty: 200, unit: 'g', name: 'mąki pszennej' }],
    ['200g mąki', { qty: 200, unit: 'g', name: 'mąki' }],
    ['2 łyżki oliwy z oliwek', { qty: 2, unit: 'tbsp', name: 'oliwy z oliwek' }],
    ['1 łyżeczka papryki słodkiej', { qty: 1, unit: 'tsp', name: 'papryki słodkiej' }],
    ['3 łyżek cukru', { qty: 3, unit: 'tbsp', name: 'cukru' }],
    ['½ szklanki mleka', { qty: 0.5, unit: 'glass', name: 'mleka' }],
    ['2 szklanki mąki', { qty: 2, unit: 'glass', name: 'mąki' }],
    ['1,5 kg ziemniaków', { qty: 1.5, unit: 'kg', name: 'ziemniaków' }],
    ['25 dag sera', { qty: 25, unit: 'dag', name: 'sera' }],
    ['250ml mleka', { qty: 250, unit: 'ml', name: 'mleka' }],
    ['1 l bulionu', { qty: 1, unit: 'l', name: 'bulionu' }],
    ['3 jajka', { qty: 3, unit: null, name: 'jajka' }],
    ['2-3 ząbki czosnku', { qty: 2.5, unit: 'clove', name: 'czosnku' }],
    ['1 ząbek czosnku', { qty: 1, unit: 'clove', name: 'czosnku' }],
    ['Szczypta soli', { qty: 1, unit: 'pinch', name: 'soli' }],
    ['garść rukoli', { qty: 1, unit: 'handful', name: 'rukoli' }],
    ['1 puszka pomidorów', { qty: 1, unit: 'can', name: 'pomidorów' }],
    ['1 opakowanie mozzarelli', { qty: 1, unit: 'pack', name: 'mozzarelli' }],
    ['1 op. cukru wanilinowego', { qty: 1, unit: 'pack', name: 'cukru wanilinowego' }],
    ['pół kostki masła', { qty: 0.5, unit: 'cube', name: 'masła' }],
    ['2 plastry szynki', { qty: 2, unit: 'slice', name: 'szynki' }],
    ['pęczek koperku', { qty: 1, unit: 'bunch', name: 'koperku' }],
    ['1 duża cebula', { qty: 1, unit: null, name: 'cebula', size: 'large' }],
    ['2 średnie marchewki', { qty: 2, unit: null, name: 'marchewki', size: 'medium' }],
    ['1 cebula (ok. 150 g)', { qty: 1, unit: null, name: 'cebula', grams: 150 }],
    ['Mąka pszenna – 500 g', { qty: 500, unit: 'g', name: 'Mąka pszenna' }],
    ['Cukier: 2 łyżki', { qty: 2, unit: 'tbsp', name: 'Cukier' }],
    ['polędwica wołowa 300 g', { qty: 300, unit: 'g', name: 'polędwica wołowa' }],
    ['Jajka 3 szt.', { qty: 3, unit: 'piece', name: 'Jajka' }],
    ['400g pomidorów z puszki', { qty: 400, unit: 'g', name: 'pomidorów z puszki' }],
    ['🍗 500 g piersi z kurczaka', { qty: 500, unit: 'g', name: 'piersi z kurczaka' }],
    ['- 1 łyżeczka cynamonu', { qty: 1, unit: 'tsp', name: 'cynamonu' }],
    ['• 150 ml śmietanki 30%', { qty: 150, unit: 'ml', name: 'śmietanki 30%' }],
    ['Mleko 3,2% 200 ml', { qty: 200, unit: 'ml', name: 'Mleko 3,2%' }],
    ['2 x 100 g jogurtu', { qty: 200, unit: 'g', name: 'jogurtu' }],
    ['2 i 1/2 szklanki mąki pszennej (np. tortowej)', { qty: 2.5, unit: 'glass', name: 'mąki pszennej' }],
    ['2 płaskie łyżeczki proszku do pieczenia', { qty: 2, unit: 'tsp', name: 'proszku do pieczenia' }],
    ['pół płaskiej łyżeczki papryki ostrej', { qty: 0.5, unit: 'tsp', name: 'papryki ostrej' }],
    ['3 szklanki mąki -400 g', { qty: 3, unit: 'glass', name: 'mąki', grams: 400 }],
    ['6 średnich pomidorów - 850 g', { qty: 6, unit: null, name: 'pomidorów', grams: 850, size: 'medium' }],
    ['polędwica 2 sztuki', { qty: 2, unit: 'piece', name: 'polędwica' }],
    ['4 średnie ząbki czosnku', { qty: 4, unit: 'clove', name: 'czosnku', size: 'medium' }],
    ['3 średnie cebule - 350 g', { qty: 3, unit: null, name: 'cebule', grams: 350, size: 'medium' }],
    ['papryki: 2 żółte, 2 czerwone = 850 g', { qty: null, unit: null, name: 'papryki', grams: 850 }],
  ];
  for (const [line, exp] of cases) assert.deepEqual(P(line), exp, line);
});

test('English ingredient lines', () => {
  const cases = [
    ['1 1/2 cups flour', { qty: 1.5, unit: 'cup', name: 'flour' }],
    ['2 tbsp olive oil', { qty: 2, unit: 'tbsp', name: 'olive oil' }],
    ['1/2 tsp salt', { qty: 0.5, unit: 'tsp', name: 'salt' }],
    ['2 cloves garlic, minced', { qty: 2, unit: 'clove', name: 'garlic' }],
    ['a pinch of salt', { qty: 1, unit: 'pinch', name: 'salt' }],
    ['8 oz cream cheese, softened', { qty: 8, unit: 'oz', name: 'cream cheese' }],
    ['1 lb ground beef', { qty: 1, unit: 'lb', name: 'ground beef' }],
    ['1 can (400 g) chickpeas', { qty: 1, unit: 'can', name: 'chickpeas', grams: 400 }],
    ['2 medium onions, diced', { qty: 2, unit: null, name: 'onions', size: 'medium' }],
    ['3 eggs', { qty: 3, unit: null, name: 'eggs' }],
    ['50g egg whites', { qty: 50, unit: 'g', name: 'egg whites' }],
    ['1 and 1/2 cups milk', { qty: 1.5, unit: 'cup', name: 'milk' }],
  ];
  for (const [line, exp] of cases) assert.deepEqual(P(line), exp, line);
});

test('notes, to-taste and headings', () => {
  const a = parseIngredient('1 duża cebula, posiekana');
  assert.equal(a.note, 'posiekana');
  const b = parseIngredient('sól i pieprz do smaku');
  assert.equal(b.toTaste, true);
  assert.equal(b.name, 'sól i pieprz');
  assert.equal(parseIngredient('Sos:').head, true);
  assert.equal(parseIngredient('Ciasto').head, true);
  assert.equal(parseIngredient('For the sauce:').head, true);
  const c = parseIngredient('polędwica wołowa');
  assert.equal(c.qty, null);
  assert.equal(c.name, 'polędwica wołowa');
});

test('servings detection', () => {
  assert.equal(parseServings('Składniki (na 4 porcje):'), 4);
  assert.equal(parseServings('Przepis dla 2 osób'), 2);
  assert.equal(parseServings('Serves 6'), 6);
  assert.equal(parseServings('Makes 12 servings'), 12);
  assert.equal(parseServings('PORCJE: 2'), 2);
  assert.equal(parseServings('Bez porcji'), null);
});

test('caption with headers, bullets, numbered steps and hashtags', () => {
  const r = splitRecipeText(`Makaron z kurczakiem w sosie śmietanowym 🍝🔥 Idealny obiad w 20 minut!
Składniki (na 2 porcje):
- 200 g makaronu penne
- 1 pierś z kurczaka (ok. 300 g)
- 2 ząbki czosnku
- garść szpinaku
- sól, pieprz
Przygotowanie:
1. Makaron ugotuj al dente.
2. Kurczaka pokrój w kostkę i podsmaż na oliwie.
3. Dodaj czosnek i szpinak.
#obiad #przepis #makaron`);
  assert.equal(r.title, 'Makaron z kurczakiem w sosie śmietanowym');
  assert.equal(r.servings, 2);
  assert.deepEqual(r.ingredients, ['200 g makaronu penne', '1 pierś z kurczaka (ok. 300 g)', '2 ząbki czosnku', 'garść szpinaku', 'sól, pieprz']);
  assert.equal(r.steps.length, 3);
  assert.equal(r.steps[0], 'Makaron ugotuj al dente.');
  assert.ok(!r.steps.join(' ').includes('#'));
});

test('English one-paragraph caption with inline sections', () => {
  const r = splitRecipeText('High protein breakfast burrito 🌯 only 450 kcal! Ingredients: 3 eggs, 50g egg whites, 1 tortilla, 30 g cheddar, 2 tbsp salsa. Instructions: Scramble the eggs with the whites. Warm the tortilla. Fill, roll and toast in a pan. #protein');
  assert.equal(r.title, 'High protein breakfast burrito');
  assert.deepEqual(r.ingredients, ['3 eggs', '50g egg whites', '1 tortilla', '30 g cheddar', '2 tbsp salsa']);
  assert.equal(r.steps.length, 3);
});

test('caption without headers: ingredient lines then prose', () => {
  const r = splitRecipeText(`Najlepsze placki z cukinii! 🥒
2 cukinie
2 jajka
4 łyżki mąki
Sól i pieprz do smaku
Cukinię zetrzyj na tarce, odciśnij wodę. Dodaj jajka i mąkę, dopraw. Smaż na rozgrzanym oleju z obu stron.`);
  assert.equal(r.title, 'Najlepsze placki z cukinii');
  assert.deepEqual(r.ingredients, ['2 cukinie', '2 jajka', '4 łyżki mąki', 'Sól i pieprz do smaku']);
  assert.equal(r.steps.length, 3);
});

test('macro summary lines are not ingredients', () => {
  const r = splitRecipeText(`🔥 520 kcal | 45 g białka
Kurczak teriyaki z ryżem
Składniki:
🍗 400 g udek z kurczaka
🍚 150 g ryżu basmati
Sposób przygotowania: Kurczaka pokrój i usmaż. Podawaj z ryżem.`);
  assert.equal(r.title, 'Kurczak teriyaki z ryżem');
  assert.deepEqual(r.ingredients, ['400 g udek z kurczaka', '150 g ryżu basmati']);
  assert.equal(r.steps.length, 2);
});

test('TikTok one-line caption (double spaces = line breaks)', () => {
  const r = splitRecipeText('Boicie się robić sushi w domu? Dziś pokażę Wam jak.  Składniki:  250 g ryżu do sushi 300 ml wody  40 ml octu ryżowego  20 g cukru  3 g soli  Po doprowadzeniu ryżu  do wrzenia, zmniejsz ogień i gotuj 15 min. Wyłącz ogień. #sushi #przepis');
  assert.deepEqual(r.ingredients, ['250 g ryżu do sushi', '300 ml wody', '40 ml octu ryżowego', '20 g cukru', '3 g soli']);
  assert.ok(r.steps[0].startsWith('Po doprowadzeniu ryżu do wrzenia'));
});

test('TikTok caption with inline * bullets and sub-headings', () => {
  const r = splitRecipeText('🍰 METROWIEC Ciasto: * 8 jajek * 15 łyżek oleju * 3 szklanki mąki -400 g Krem: * 3 szklanki mleka * 370 g masła');
  assert.deepEqual(r.ingredients, ['Ciasto:', '8 jajek', '15 łyżek oleju', '3 szklanki mąki -400 g', 'Krem:', '3 szklanki mleka', '370 g masła']);
});

test('TikTok caption with no colons or double spaces at all (oEmbed title)', () => {
  // Some oEmbed titles collapse every line break to a single space, so "Ingredients"/"Instructions"
  // land mid-sentence with no colon or extra spacing to mark them — the title must not swallow the rest.
  const r = splitRecipeText('Marry Me Chicken Pasta Ingredients Chicken 2 chicken breasts, sliced horizontally and pounded to an even thickness A drizzle of oil, for cooking Salt and black pepper, to taste 1 tsp onion powder 1 tsp garlic powder 1 tsp paprika Pasta Your favorite pasta, cooked according to package directions Instructions Prepare the chicken: Slice each chicken breast in half horizontally and pound gently.');
  assert.equal(r.title, 'Marry Me Chicken Pasta');
  assert.ok(r.ingredients.length > 0);
  assert.ok(r.steps.length > 0);
});

test('website text: yield lines skipped, sub-headings kept, end sections dropped', () => {
  const r = splitRecipeText(`Składniki
16 - 17 sztuk
Ciasto
• 2 szklanki mleka
• 3 jajka
Nadzienie
• 400 g twarogu
Przygotowanie
• Jajka rozmiksować z mlekiem.
• Smażyć z dwóch stron.
Propozycja podania
Sos malinowy: 250 malin zmiksować.`);
  assert.deepEqual(r.ingredients, ['Ciasto', '2 szklanki mleka', '3 jajka', 'Nadzienie', '400 g twarogu']);
  assert.deepEqual(r.steps, ['Jajka rozmiksować z mlekiem.', 'Smażyć z dwóch stron.']);
});

test('YouTube description: promo text before the real "SKŁADNIKI:" header is ignored', () => {
  const r = splitRecipeText(`ZAMÓW eBOOK 30% TANIEJ! ➡️ Sklep.pl
A co w środku? Prawie 400 stron:
✔︎150 sprawdzonych przepisów krok po kroku
✔︎Proste składniki więc łatwe i tanie gotowanie!

🔥MAKARON Z KURCZAKIEM Z JEDNEJ PATELNI⤵️
⏰CZAS: 25 MINUT
🍽️PORCJE: 2

📌 SKŁADNIKI:
250g piersi z kurczaka
½ łyżeczki soli

200g makaronu penne
#kurczak #makaron`);
  assert.deepEqual(r.ingredients, ['250g piersi z kurczaka', '½ łyżeczki soli', '200g makaronu penne']);
  assert.deepEqual(r.steps, []);
  assert.equal(r.servings, 2);
  assert.equal(shortTitle('PROSTY KURCZAK Z MAKARONEM'), 'Prosty kurczak z makaronem');
});

test('shortTitle and durations', () => {
  assert.equal(shortTitle('przepis na pyszne naleśniki. Zobacz!'), 'Pyszne naleśniki');
  assert.equal(shortTitle('#fit Owsianka 🍓 szybka'), 'Owsianka');
  assert.equal(durationMin('PT1H20M'), 80);
  assert.equal(durationMin('PT45M'), 45);
  assert.equal(durationMin(''), null);
});
