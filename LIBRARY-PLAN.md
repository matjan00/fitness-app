# Recipe library - plan for the full import

Pilot state: 15 recipes (9 TheMealDB, 6 rewritten classics), MyPlate skipped (see below). Format: top of docs/food-library.js.
Everything is rebuilt with `node scripts/library/build.mjs [mealdb|classics|myplate]`; it converts, validates, and rewrites docs/data/library/*.json + index.json. Then add any NEW file names to docs/sw.js CORE, `node --test`, `node scripts/release.cjs`.

## TheMealDB (base)
- Free test key "1": https://www.themealdb.com/api/json/v1/1/ . Areas are inconsistent: French recipes live under `a=France` (not French), Italian `a=Italian`, Polish `a=Polish`. Other areas: `list.php?a=list`.
- List an area: `filter.php?a=Italian` (21 Italian, 27 France, 26 Polish). Then put ALL ids in scripts/library/mealdb-ids.json ({cuisine: [ids]}) and run `node scripts/library/build.mjs mealdb` (0.3 s per lookup, ~2 min for 80 recipes). For other cuisines add keys, and add the area name to AREA_CUISINE in convert.mjs (unknown areas fall back to 'international'; add a CUISINES entry in food-library.js for a card).
- Fix-ups per recipe go in scripts/library/mealdb-overrides.json: {"<id>": {"servings": 6, "lines": {"<original line>": "<replacement line>"}}}. MealDB has no servings (assumed 4, cakes/bread 12), no times (guessed from the "N minutes" mentioned in the method, prep fixed at 15), no difficulty (guessed from counts). All flagged: `time_est: true`.
- Review after the full build: recipes with `checks` >= 3, kcal/protein outliers (bone-in meat weights inflate protein; "Chicken Legs" matches breast), wrong matches (brandy matched oat bran). The build prints kcal, protein and checks per recipe.
- Expected size: ~75 recipes for I/F/P, ~1 MB per 300 recipes (about 3 KB each, images are remote URLs). Photos load from themealdb.com (`/medium` suffix for cards).
- Licensing: API is free with the test key for personal/educational use; recipes and photos are user-contributed, no open licence. Fine for a private app; before making it public or commercial, TheMealDB asks for a paid (Patreon) key. Photos are hot-linked, not copied.

## Classics (public domain, rewritten by hand)
- Sources verified online: Artusi, La scienza in cucina (Italian original, Project Gutenberg #59047, plain text at gutenberg.org/cache/epub/59047/pg59047.txt; recipes numbered "78. Risotto alla milanese I"); The Italian Cook Book 1919 (Gutenberg #24407, not yet used); Escoffier, A Guide to Modern Cookery (English, Gutenberg #71395, numbered "751-SOUPE AUX ..."); Cwierczakiewiczowa, 365 obiadow za 5 zlotych 1871 (pl.wikisource.org, marked public domain; per-recipe pages via the API: `api.php?action=parse&page=365_obiad%C3%B3w_za_5_z%C5%82otych/<Title>&prop=text&format=json&formatversion=2`; the index of titles: `list=prefixsearch&pssearch=365 obiadów za 5 złotych/`). Ochorowicz-Monatowa 1910 not checked (only the 1871 book was verified).
- Workflow per batch of ~10 dishes per cuisine: grep the plain text for the dish, read the recipe, write the modern version into scripts/library/classics.json (same raw shape as the pilot entries: ingredient lines like "200 g flour", steps, times, source with book, number, year, url). Rewrite, never paste. 40 per cuisine = 120 recipes = 4 batches per cuisine; ~1 KB source each. Artusi/Ćwierczakiewiczowa give few weights ("quantities are estimates" goes in notes), Escoffier uses pints/oz (1 pint = 570 ml).
- Run `node scripts/library/build.mjs classics`, check the per-recipe kcal, fix `checks`.
- Licensing: all authors died before 1935 and the books are PD (Gutenberg / Wikisource state it). The rewritten text is ours.

## USDA MyPlate Kitchen
- NOT FETCHABLE: www.myplate.gov returns HTTP 403 to scripted requests (curl and WebFetch, with and without a browser user agent), so no recipes were imported and licensing was not verified on the site. Content of US federal websites is generally public domain, but check the site's own copyright page in a browser.
- Options for next week: (a) you open a few recipe pages in the browser and save them / paste them, and I convert them (scripts/library/myplate.json in the same raw shape, `source_nutrition` kept for comparison, cuisine 'american'); (b) look for USDA open data instead (FoodData Central / "What's Cooking? USDA Mixing Bowl" datasets on data.gov); (c) drop MyPlate. build.mjs already reads scripts/library/myplate.json when it exists and lists it as a source.

## App notes
- Library data is lazy loaded (index.json, then one file per source) and cached by the service worker; add each new data file to sw.js CORE.
- Favourites/ratings: store config 'library' {favs, cooked}. Diary entries from the library use source {type: 'library', id}.
- Later ideas: recipe photos for classics (none yet, cuisine placeholder tile), a "cooked it" history list, sorting by rating.
